package deploy

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"brain/server/internal/hostlogs"
	"brain/server/internal/monitor"
)

const hostPrefix = "process:"

var hostKeyPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var hostEnvName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type hostState struct {
	AppendLog bool          `json:"appendLog"`
	Request   DeployRequest `json:"request"`
	Handle    string        `json:"handle"`
	PID       int           `json:"pid"`
	Marker    string        `json:"marker"`
	Port      int           `json:"port"`
	LogFile   string        `json:"logFile"`
	Status    string        `json:"status"`
}
type hostControl struct {
	mu       sync.Mutex
	cancelMu sync.Mutex
	cancel   context.CancelFunc
}

var hostControlsMu sync.Mutex
var hostControls = map[string]*hostControl{}

func controlFor(handle string) *hostControl {
	hostControlsMu.Lock()
	defer hostControlsMu.Unlock()
	if hostControls[handle] == nil {
		hostControls[handle] = &hostControl{}
	}
	return hostControls[handle]
}
func hostRoot() string {
	if root := os.Getenv("RAY_HOST_RUNTIME_DIR"); root != "" {
		return root
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".ray", "host-runtimes")
}
func hostDir(handle string) (string, error) {
	key := strings.TrimPrefix(handle, hostPrefix)
	if !strings.HasPrefix(handle, hostPrefix) || !hostKeyPattern.MatchString(key) {
		return "", fmt.Errorf("invalid host runtime handle")
	}
	return filepath.Join(hostRoot(), key), nil
}
func hostHandle(req DeployRequest) string {
	identity := req.ProjectID
	if identity == "" {
		identity = req.ID
	}
	hash := sha256.Sum256([]byte(req.UserID + "\x00" + identity))
	return hostPrefix + hex.EncodeToString(hash[:])
}
func readHostState(handle string) (*hostState, error) {
	dir, err := hostDir(handle)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(dir, "state.json"))
	if err != nil {
		return nil, err
	}
	var state hostState
	if err = json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	if state.Handle != handle || hostHandle(state.Request) != handle {
		return nil, fmt.Errorf("invalid host runtime identity")
	}
	return &state, nil
}
func writeHostState(state *hostState) error {
	dir, err := hostDir(state.Handle)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".state-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	data, err := json.Marshal(state)
	if err == nil {
		_, err = tmp.Write(data)
	}
	closeErr := tmp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp.Name(), filepath.Join(dir, "state.json"))
}
func hostEnvironment(req DeployRequest, dir string, port int) ([]string, error) {
	// Do not inherit database credentials, JWT secrets or provider tokens from Brain.
	values := map[string]string{"PATH": os.Getenv("PATH"), "HOME": filepath.Join(dir, "home"), "TMPDIR": filepath.Join(dir, "tmp"), "LANG": "C.UTF-8", "PYTHONUNBUFFERED": "1", "NODE_ENV": "production"}
	for key, value := range req.EnvVars {
		if !hostEnvName.MatchString(key) || strings.ContainsRune(value, 0) {
			return nil, fmt.Errorf("invalid environment variable name or value")
		}
		values[key] = value
	}
	values["PORT"] = strconv.Itoa(port)
	result := make([]string, 0, len(values))
	for k, v := range values {
		result = append(result, k+"="+v)
	}
	return result, nil
}
func randomHostMarker() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		panic(err)
	}
	return "ray-host-" + hex.EncodeToString(raw[:])
}
func hostResult(state *hostState) *DeployResult {
	logs := ""
	if state.Status == "failed" {
		logs = "[ERROR] Host application stopped. Open Monitor to inspect its application logs."
	}
	return &DeployResult{DeploymentID: state.Request.ID, ProjectID: state.Request.ProjectID, Name: state.Request.Name, ContainerName: state.Handle,
		HostPort: state.Port, DeployURL: runtimeURL(state.Request, state.Port), Status: state.Status, ManagedPID: state.PID, ManagedLogFile: state.LogFile, Runtime: "host", BuildLogs: logs}
}
func hostHealth(ctx context.Context, state *hostState) error {
	host, _ := routingHost(state.Request)
	return waitForHealth(ctx, state.Port, state.Request.HealthCheck, func() bool { return hostProcessAlive(state.PID, state.Marker) }, host)
}

func startHost(state *hostState) error {
	dir, err := hostDir(state.Handle)
	if err != nil {
		return err
	}
	for _, child := range []string{"home", "tmp"} {
		if err = os.MkdirAll(filepath.Join(dir, child), 0700); err != nil {
			return err
		}
	}
	environment, err := hostEnvironment(state.Request, dir, state.Port)
	if err != nil {
		return err
	}
	state.Marker = randomHostMarker()
	state.LogFile = filepath.Join(dir, "application-"+strings.TrimPrefix(state.Marker, "ray-host-")+".log")
	if err := hostlogs.Initialize(state.LogFile); err != nil {
		return err
	}
	state.AppendLog = false
	cmd, err := hostLogCommand(state.Request.StartCommand, state.Marker, state.LogFile)
	if err != nil {
		return err
	}
	cmd.Dir = state.Request.ProjectPath
	cmd.Env = environment
	cmd.Stderr = os.Stderr
	if err = cmd.Start(); err != nil {
		return err
	}
	state.PID = cmd.Process.Pid
	state.Status = "building"
	// The independent child owns both log rotation and the application. It keeps
	// draining output when Brain exits; both share the verified process group.
	go func() { _ = cmd.Wait(); killOwnedHostGroup(cmd.Process.Pid) }()
	if err = writeHostState(state); err != nil {
		_ = terminateHostGroup(state.PID, state.Marker)
		return err
	}
	return nil
}
func runHostBuild(ctx context.Context, req DeployRequest, dir string, port int, emit func(DeployStepEvent)) error {
	if req.BuildCommand == "" {
		return nil
	}
	environment, err := hostEnvironment(req, dir, port)
	if err != nil {
		return err
	}
	// Build tools commonly require dev dependencies; runtime still defaults to production.
	if _, explicit := req.EnvVars["NODE_ENV"]; !explicit {
		for i, value := range environment {
			if strings.HasPrefix(value, "NODE_ENV=") {
				environment[i] = "NODE_ENV=development"
			}
		}
	}
	for _, child := range []string{"home", "tmp"} {
		if err = os.MkdirAll(filepath.Join(dir, child), 0700); err != nil {
			return err
		}
	}
	logFile, err := os.OpenFile(filepath.Join(dir, "build.log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer logFile.Close()
	cmd := hostCommand(req.BuildCommand, randomHostMarker())
	cmd.WaitDelay = 2 * time.Second
	cmd.Dir = req.ProjectPath
	cmd.Env = environment
	reader, writer := io.Pipe()
	cmd.Stdout = io.MultiWriter(logFile, writer)
	cmd.Stderr = cmd.Stdout
	if err = cmd.Start(); err != nil {
		reader.Close()
		writer.Close()
		return err
	}
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			killOwnedHostGroup(cmd.Process.Pid)
		case <-done:
		}
	}()
	scanned := make(chan struct{})
	go func() {
		defer close(scanned)
		scanner := bufio.NewScanner(reader)
		scanner.Buffer(make([]byte, 4096), 1024*1024)
		for scanner.Scan() {
			emit(DeployStepEvent{Step: StepBuilding, Status: "running", LogDelta: scanner.Text() + "\n"})
		}
		reader.Close()
	}()
	err = cmd.Wait()
	killOwnedHostGroup(cmd.Process.Pid)
	close(done)
	writer.Close()
	<-scanned
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return err
}

func executeHostDeployment(ctx context.Context, req DeployRequest, emit func(DeployStepEvent)) (resultOut *DeployResult, deployErr error) {
	if !hostSupported() {
		return nil, fmt.Errorf("Docker-off deployment currently requires Linux or macOS")
	}
	if req.UserID == "" || (req.ID == "" && req.ProjectID == "") {
		return nil, fmt.Errorf("host deployment requires an owner and project identity")
	}
	if strings.TrimSpace(req.StartCommand) == "" {
		return nil, fmt.Errorf("enter a production start command for Docker-off deployment")
	}
	for _, command := range []string{req.StartCommand, req.BuildCommand} {
		if len(command) > 4096 || strings.ContainsAny(command, "\x00\r\n") {
			return nil, fmt.Errorf("commands must be single lines of at most 4096 bytes")
		}
	}
	if req.HostPort < 0 || req.HostPort > 65535 {
		return nil, fmt.Errorf("invalid host port")
	}
	if _, reserved := ReservedPorts[req.HostPort]; reserved || req.HostPort == 4500 || req.HostPort == 4567 {
		return nil, fmt.Errorf("host port is reserved")
	}
	path, err := filepath.EvalSymlinks(req.ProjectPath)
	if err != nil {
		return nil, fmt.Errorf("source directory is unavailable")
	}
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("choose an existing source directory")
	}
	req.ProjectPath = path
	if req.RepoURL != "" || req.SourceType == "github" {
		return nil, fmt.Errorf("prepare source before a host deployment")
	}
	req.GitHubToken = ""
	handle := hostHandle(req)
	control := controlFor(handle)
	if !control.mu.TryLock() {
		return nil, fmt.Errorf("a deployment or action is already running for this project")
	}
	defer control.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	control.cancelMu.Lock()
	control.cancel = cancel
	control.cancelMu.Unlock()
	defer func() { cancel(); control.cancelMu.Lock(); control.cancel = nil; control.cancelMu.Unlock() }()
	if _, err := os.Stat(hostJournalPath(handle)); !os.IsNotExist(err) {
		return nil, fmt.Errorf("an interrupted host replacement requires recovery before deploying again")
	}
	previous, readErr := readHostState(handle)
	if readErr != nil && !os.IsNotExist(readErr) {
		return nil, readErr
	}
	port := req.HostPort
	if port == 0 && previous != nil {
		port = previous.Port
	}
	if port == 0 {
		for candidate := 4000; candidate < 6000; candidate++ {
			if _, reserved := ReservedPorts[candidate]; reserved || candidate == 4500 || candidate == 4567 {
				continue
			}
			if ensureRoutePortAvailable(candidate, handle) == nil && isSocketFree(candidate) {
				port = candidate
				break
			}
		}
	}
	if port == 0 {
		return nil, fmt.Errorf("no available host port")
	}
	if err := ensureRoutePortAvailable(port, handle); err != nil {
		return nil, err
	}
	previousRunning := previous != nil && hostProcessAlive(previous.PID, previous.Marker)
	if !(previousRunning && previous.Port == port) && !isSocketFree(port) {
		return nil, fmt.Errorf("port %d is in use; choose another port", port)
	}
	dir, _ := hostDir(handle)
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	if !req.sourcePrepared {
		return nil, fmt.Errorf("host deployment requires a security-prepared source")
	}
	emit(DeployStepEvent{Step: StepSourceCheck, Status: "success", Message: "Source verified for host deployment"})
	emit(DeployStepEvent{Step: StepBuilding, Status: "running", Message: "Running the configured build command on the host"})
	if !req.skipBuild {
		if err = runHostBuild(ctx, req, dir, port, emit); err != nil {
			return nil, fmt.Errorf("host build failed: %w", err)
		}
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	journal := &hostJournal{Request: req, Previous: previous, WasRunning: previousRunning}
	if err := atomicSecurityJSON(hostJournalPath(handle), journal); err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if committed {
			return
		}
		restored, recoveryErr := restoreHostJournal(handle, journal)
		if recoveryErr != nil {
			deployErr = fmt.Errorf("%v; previous release recovery incomplete: %w", deployErr, recoveryErr)
			emit(DeployStepEvent{Step: "rollback", Status: "error", Message: deployErr.Error()})
		} else if restored != nil && restored.Status == "healthy" {
			emit(DeployStepEvent{Step: "rollback", Status: "success", RuntimeRestored: true, ActiveDeploymentID: restored.Request.ID, ProjectPath: restored.Request.ProjectPath, Port: restored.Port, URL: hostResult(restored).DeployURL, Container: handle, Message: "Previous host release restored"})
		}
	}()
	// A failed build leaves the previous process running. Replacement starts here.
	if previousRunning {
		if err = terminateHostGroup(previous.PID, previous.Marker); err != nil {
			return nil, err
		}
	}
	state := &hostState{Request: req, Handle: handle, Port: port}
	emit(DeployStepEvent{Step: StepLaunching, Status: "running", Message: "Starting application directly on the host"})
	if err = startHost(state); err == nil {
		if monitorErr := registerHostMonitor(state); monitorErr != nil {
			emit(DeployStepEvent{Step: StepMonitor, Status: "running", Message: "Application logs are saved, but monitor registration failed: " + monitorErr.Error()})
		}
		emit(DeployStepEvent{Step: StepHealthcheck, Status: "running", Message: "Waiting for the configured application health check"})
		err = hostHealth(ctx, state)
		if err == nil {
			_, err = applyRouting(ctx, req, port, handle)
		}
	}
	if err != nil {
		return nil, err
	}
	state.Status = "healthy"
	if err = writeHostState(state); err != nil {
		_ = terminateHostGroup(state.PID, state.Marker)
		return nil, err
	}
	journal.Completed = state
	if err := atomicSecurityJSON(hostJournalPath(handle), journal); err != nil {
		journal.Completed = nil
		return nil, err
	}
	committed = true
	if _, err := restoreHostJournal(handle, journal); err != nil {
		fmt.Printf("[deploy] host commit needs recovery: %v\n", err)
	}
	result := hostResult(state)
	SaveDeploymentViaRayAPI(result, req)
	emit(DeployStepEvent{Step: StepComplete, Status: "success", Message: "Application is running directly on the host", Port: port, URL: result.DeployURL, Container: handle, Runtime: "host", ManagedPID: state.PID, LogFile: state.LogFile, ProjectPath: req.ProjectPath})
	watchHost(handle, state.Marker)
	return result, nil
}

func watchHost(handle, marker string) {
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			control := controlFor(handle)
			if !control.mu.TryLock() {
				continue
			}
			release, lockErr := AcquireOperation()
			if lockErr != nil {
				control.mu.Unlock()
				continue
			}
			state, err := readHostState(handle)
			if err != nil || state.Marker != marker || state.Status == "stopped" || state.Status == "failed" {
				release()
				control.mu.Unlock()
				return
			}
			if hostProcessAlive(state.PID, state.Marker) {
				release()
				control.mu.Unlock()
				continue
			}
			state.Status = "failed"
			state.PID = 0
			_ = writeHostState(state)
			if f, err := os.OpenFile(state.LogFile, os.O_APPEND|os.O_WRONLY, 0600); err == nil {
				fmt.Fprintln(f, "\n[RAY] Managed process exited unexpectedly. Restart the deployment after reviewing its logs.")
				f.Close()
			}
			SaveDeploymentViaRayAPI(hostResult(state), state.Request)
			release()
			control.mu.Unlock()
			return
		}
	}()
}
func StopHostRuntime(handle string) error {
	cancelActiveRuntime(handle)
	control := controlFor(handle)
	control.cancelMu.Lock()
	if control.cancel != nil {
		control.cancel()
	}
	control.cancelMu.Unlock()
	control.mu.Lock()
	defer control.mu.Unlock()
	state, err := readHostState(handle)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if state.Status == "stopped" && !hostProcessAlive(state.PID, state.Marker) {
		return nil
	}
	if err = removeRuntimeRoute(handle); err != nil {
		return err
	}
	if err = terminateHostGroup(state.PID, state.Marker); err != nil {
		return err
	}
	state.PID = 0
	state.Status = "stopped"
	if err = writeHostState(state); err != nil {
		return err
	}
	SaveDeploymentViaRayAPI(hostResult(state), state.Request)
	return nil
}
func RestartHostRuntime(handle string) error {
	control := controlFor(handle)
	if !control.mu.TryLock() {
		return fmt.Errorf("project has an operation in progress")
	}
	defer control.mu.Unlock()
	state, err := readHostState(handle)
	if err != nil {
		return err
	}
	gateCtx, gateCancel := context.WithTimeout(context.Background(), 75*time.Second)
	defer gateCancel()
	baseline, err := runSecurityGate(gateCtx, state.Request, func(DeployStepEvent) {})
	if err != nil {
		return err
	}
	if err = removeRuntimeRoute(handle); err != nil {
		return err
	}
	if err = terminateHostGroup(state.PID, state.Marker); err != nil {
		return err
	}
	state.PID = 0
	state.Status = "failed"
	if err = writeHostState(state); err != nil {
		return err
	}
	defer func() {
		if state.Status != "healthy" {
			_ = terminateHostGroup(state.PID, state.Marker)
			state.PID = 0
			state.Status = "failed"
			_ = writeHostState(state)
			SaveDeploymentViaRayAPI(hostResult(state), state.Request)
		}
	}()
	if !isSocketFree(state.Port) {
		return fmt.Errorf("port %d is in use", state.Port)
	}
	if err = startHost(state); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 310*time.Second)
	defer cancel()
	if err = hostHealth(ctx, state); err != nil {
		_ = terminateHostGroup(state.PID, state.Marker)
		state.Status = "failed"
		state.PID = 0
		_ = writeHostState(state)
		SaveDeploymentViaRayAPI(hostResult(state), state.Request)
		return err
	}
	if _, err = applyRouting(ctx, state.Request, state.Port, handle); err != nil {
		return err
	}
	state.Status = "healthy"
	if err = writeHostState(state); err != nil {
		return err
	}
	if baseline != nil {
		_ = atomicSecurityJSON(filepath.Join(securityDir(state.Request), "baseline.json"), baseline)
	}
	_ = registerHostMonitor(state)
	SaveDeploymentViaRayAPI(hostResult(state), state.Request)
	watchHost(handle, state.Marker)
	return nil
}
func HostRuntimeLogs(handle string, lines int) (string, error) {
	state, err := readHostState(handle)
	if err != nil {
		return "", err
	}
	return monitor.ReadFileTail(state.LogFile, lines)
}

// Recovery reattaches supervision to surviving processes; it never signals a saved
// PID without verifying its unique shell marker and process group first.
func RecoverHostRuntimes() {
	entries, _ := os.ReadDir(hostRoot())
	for _, entry := range entries {
		if !entry.IsDir() || !hostKeyPattern.MatchString(entry.Name()) {
			continue
		}
		handle := hostPrefix + entry.Name()
		recoverHostRuntime(handle)
	}
}
func recoverHostRuntime(handle string) {
	release, lockErr := AcquireOperation()
	if lockErr != nil {
		return
	}
	defer release()
	if _, err := os.Stat(hostJournalPath(handle)); err == nil {
		if err := RecoverHostReplacement(handle); err != nil {
			fmt.Printf("[deploy] host recovery incomplete: %v\n", err)
			return
		}
	}
	control := controlFor(handle)
	control.mu.Lock()
	state, err := readHostState(handle)
	if err != nil || (state.Status != "healthy" && state.Status != "building") {
		control.mu.Unlock()
		return
	}
	if !hostProcessAlive(state.PID, state.Marker) {
		control.mu.Unlock()
		// Resume only runtimes which were expected to be running. An explicitly stopped
		// or previously failed runtime is never automatically started.
		if err := RestartHostRuntime(handle); err != nil {
			control.mu.Lock()
			defer control.mu.Unlock()
			current, readErr := readHostState(handle)
			if readErr == nil && current.Marker == state.Marker {
				current.Status = "failed"
				current.PID = 0
				_ = writeHostState(current)
				SaveDeploymentViaRayAPI(hostResult(current), current.Request)
			}
		}
		return
	}
	defer control.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 310*time.Second)
	defer cancel()
	if err = hostHealth(ctx, state); err != nil {
		state.Status = "failed"
	} else {
		state.Status = "healthy"
	}
	_ = writeHostState(state)
	_ = registerHostMonitor(state)
	SaveDeploymentViaRayAPI(hostResult(state), state.Request)
	if state.Status == "healthy" {
		watchHost(handle, state.Marker)
	}
}

func registerHostMonitor(state *hostState) error {
	if monitor.Global == nil {
		return fmt.Errorf("monitor service is not running")
	}
	req := state.Request
	_, err := monitor.Global.AddProject(context.Background(), &monitor.Project{ID: req.ProjectID, UserID: req.UserID, Name: req.Name, ProjectPath: req.ProjectPath, RunCommand: req.StartCommand, LogPaths: []string{state.LogFile}, ManagedPid: state.PID, ManagedLogFile: state.LogFile, IntervalSec: 30, Enabled: true})
	return err
}
func RemoveHostRuntime(handle string) error {
	if err := StopHostRuntime(handle); err != nil {
		return err
	}
	control := controlFor(handle)
	control.mu.Lock()
	defer control.mu.Unlock()
	state, _ := readHostState(handle)
	if state != nil {
		if err := terminateHostGroup(state.PID, state.Marker); err != nil {
			return err
		}
	}
	if state != nil && monitor.Global != nil {
		monitor.Global.RemoveProject(state.Request.ProjectID)
	}
	directory, err := hostDir(handle)
	if err != nil {
		return err
	}
	return os.RemoveAll(directory)
}

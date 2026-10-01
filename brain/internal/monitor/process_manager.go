package monitor

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ManagedProcess represents a project process being run and logged by Ray/Brain.
type ManagedProcess struct {
	ProjectID   string    `json:"projectId"`
	ProjectPath string    `json:"projectPath"`
	Command     string    `json:"command"`
	PID         int       `json:"pid"`
	Port        int       `json:"port,omitempty"`
	URL         string    `json:"url,omitempty"`
	LogFile     string    `json:"logFile"`
	StartedAt   time.Time `json:"startedAt"`
	cmd         *exec.Cmd
	cancel      context.CancelFunc
}

// RunningProcess describes a detected running process for a project path.
type RunningProcess struct {
	PID     int    `json:"pid"`
	Command string `json:"command"`
	Runtime string `json:"runtime"` // "node", "python", "docker", etc.
	LogFile string `json:"logFile"` // suggested log file path if managed
	Port    int    `json:"port,omitempty"`
	URL     string `json:"url,omitempty"`
}

// DockerContainerInfo describes a running Docker container for a monitored project.
type DockerContainerInfo struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Image  string `json:"image"`
	Status string `json:"status"`
	Ports  string `json:"ports"`
	Port   int    `json:"port,omitempty"`
	URL    string `json:"url,omitempty"`
}

// DetectDockerContainer checks if a Docker container is running for the project.
func DetectDockerContainer(ctx context.Context, projectName, projectPath string) *DockerContainerInfo {
	baseName := strings.ToLower(projectName)
	if baseName == "" && projectPath != "" {
		baseName = strings.ToLower(filepath.Base(projectPath))
	}
	if baseName == "" {
		return nil
	}

	out, err := RunLogCommand(ctx, `docker ps --format "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"`)
	if err != nil || strings.TrimSpace(out) == "" {
		return nil
	}

	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		parts := strings.Split(line, "\t")
		if len(parts) < 4 {
			continue
		}
		cID := parts[0]
		cName := parts[1]
		cImage := parts[2]
		cStatus := parts[3]
		cPorts := ""
		if len(parts) > 4 {
			cPorts = parts[4]
		}

		lowerName := strings.ToLower(cName)
		lowerImage := strings.ToLower(cImage)

		// Match container name or image against project name
		isMatch := strings.Contains(lowerName, "ray-"+baseName) ||
			lowerName == baseName ||
			strings.Contains(lowerName, baseName) ||
			strings.Contains(lowerImage, "ray-"+baseName) ||
			strings.Contains(lowerImage, baseName)

		if isMatch {
			port := 0
			url := ""
			re := regexp.MustCompile(`(?::|0\.0\.0\.0:)(\d+)->`)
			if m := re.FindStringSubmatch(cPorts); len(m) > 1 {
				port, _ = strconv.Atoi(m[1])
				if port > 0 {
					url = fmt.Sprintf("http://localhost:%d", port)
				}
			}

			return &DockerContainerInfo{
				ID:     cID,
				Name:   cName,
				Image:  cImage,
				Status: cStatus,
				Ports:  cPorts,
				Port:   port,
				URL:    url,
			}
		}
	}
	return nil
}

var (
	managedMu sync.Mutex
	managed   = make(map[string]*ManagedProcess) // projectID → process
)

// DetectRunningProcesses finds processes running from the given project path.
func DetectRunningProcesses(ctx context.Context, projectPath string) []RunningProcess {
	var results []RunningProcess
	seen := make(map[int]bool)

	// Strategy 0: Check Docker container running for this project
	if container := DetectDockerContainer(ctx, filepath.Base(projectPath), projectPath); container != nil {
		results = append(results, RunningProcess{
			PID:     0,
			Command: fmt.Sprintf("docker logs -f %s", container.Name),
			Runtime: "docker",
			LogFile: "docker:" + container.Name,
			Port:    container.Port,
			URL:     container.URL,
		})
	}

	// Strategy 1: lsof — find PIDs with files open in the project directory.
	cwdCmd := fmt.Sprintf(
		`lsof -w +D %s 2>/dev/null | awk 'NR>1 {print $1, $2}' | sort -u | head -30`,
		shellEscape(projectPath),
	)
	out, _ := RunLogCommand(ctx, cwdCmd)
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		name := parts[0]
		pid, err := strconv.Atoi(parts[1])
		if err != nil || pid <= 0 || seen[pid] {
			continue
		}
		if isSystemProcess(name) {
			continue
		}
		seen[pid] = true
		rt := guessRuntime(name)
		port, url := DetectPortForPID(ctx, pid, projectPath, "")
		results = append(results, RunningProcess{
			PID:     pid,
			Command: getProcessCommand(ctx, pid),
			Runtime: rt,
			LogFile: suggestLogFile(projectPath, pid),
			Port:    port,
			URL:     url,
		})
	}

	// Strategy 2: pgrep with project path.
	if runtime.GOOS != "windows" {
		pgrepOut, _ := RunLogCommand(ctx, fmt.Sprintf(`pgrep -f %s 2>/dev/null`, shellEscape(projectPath)))
		for _, line := range strings.Split(strings.TrimSpace(pgrepOut), "\n") {
			pid, err := strconv.Atoi(strings.TrimSpace(line))
			if err != nil || pid <= 0 || seen[pid] {
				continue
			}
			seen[pid] = true
			cmd := getProcessCommand(ctx, pid)
			rt := guessRuntimeFromCmd(cmd)
			port, url := DetectPortForPID(ctx, pid, projectPath, "")
			results = append(results, RunningProcess{
				PID:     pid,
				Command: cmd,
				Runtime: rt,
				LogFile: suggestLogFile(projectPath, pid),
				Port:    port,
				URL:     url,
			})
		}
	}

	return results
}

// SpawnManagedProcess kills the existing process (if any) and starts a new one
// with its stdout/stderr piped to a log file. Returns the log file path.
func SpawnManagedProcess(ctx context.Context, projectID, projectPath, command string, killPID int) (*ManagedProcess, error) {
	managedMu.Lock()
	defer managedMu.Unlock()

	// Kill existing managed process if any
	if existing, ok := managed[projectID]; ok {
		existing.cancel()
		if existing.cmd != nil && existing.cmd.Process != nil {
			_ = existing.cmd.Process.Kill()
		}
		delete(managed, projectID)
	}

	// Kill the user-specified PID if requested
	if killPID > 0 {
		killProcessTree(ctx, killPID)
	}

	// Create a log file
	logDir := os.TempDir()
	safeName := regexp.MustCompile(`[^a-zA-Z0-9_-]`).ReplaceAllString(filepath.Base(projectPath), "_")
	logFile := filepath.Join(logDir, fmt.Sprintf("ray_monitor_%s_%d.log", safeName, time.Now().Unix()))

	f, err := os.Create(logFile)
	if err != nil {
		return nil, fmt.Errorf("create log file: %w", err)
	}
	defer f.Close()

	// Spawn the command
	pCtx, cancel := context.WithCancel(context.Background()) // not tied to request ctx
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(pCtx, "cmd", "/C", command)
	} else {
		cmd = exec.CommandContext(pCtx, "sh", "-c", command)
	}
	cmd.Dir = projectPath
	cmd.Env = append(os.Environ(), "FORCE_COLOR=1", "PYTHONUNBUFFERED=1")

	// Open log file for writing
	logF, err := os.OpenFile(logFile, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("open log file for writing: %w", err)
	}
	cmd.Stdout = logF
	cmd.Stderr = logF

	if err := cmd.Start(); err != nil {
		cancel()
		logF.Close()
		return nil, fmt.Errorf("start process: %w", err)
	}

	pid := 0
	if cmd.Process != nil {
		pid = cmd.Process.Pid
	}

	mp := &ManagedProcess{
		ProjectID:   projectID,
		ProjectPath: projectPath,
		Command:     command,
		PID:         pid,
		LogFile:     logFile,
		StartedAt:   time.Now(),
		cmd:         cmd,
		cancel:      cancel,
	}
	managed[projectID] = mp

	// Goroutine to reap and cleanup
	go func() {
		_ = cmd.Wait()
		logF.Close()
	}()

	return mp, nil
}

// StopManagedProcess stops a Ray-managed process.
func StopManagedProcess(projectID string) {
	managedMu.Lock()
	defer managedMu.Unlock()
	if mp, ok := managed[projectID]; ok {
		mp.cancel()
		if mp.cmd != nil && mp.cmd.Process != nil {
			_ = mp.cmd.Process.Kill()
		}
		delete(managed, projectID)
	}
}

// GetManagedProcess returns the managed process info for a project, or nil.
func GetManagedProcess(projectID string) *ManagedProcess {
	managedMu.Lock()
	defer managedMu.Unlock()
	mp, ok := managed[projectID]
	if !ok || mp == nil {
		return nil
	}
	// Try to detect port if not already detected
	if mp.Port == 0 && mp.PID > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		port, url := DetectPortForPID(ctx, mp.PID, mp.ProjectPath, mp.LogFile)
		if port > 0 {
			mp.Port = port
			mp.URL = url
		}
	}
	// Return a snapshot so callers cannot read fields from the shared process
	// while another operation updates the managed process under managedMu.
	snapshot := *mp
	return &snapshot
}

var (
	urlLogRe       = regexp.MustCompile(`https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})`)
	portLogRe      = regexp.MustCompile(`(?i)(?:port|listening on|ready on|running at|local:)\s*(?:http://localhost:)?(?::)?(\d{2,5})`)
	listenSocketRe = regexp.MustCompile(`[:.](\d{2,5})\s+\(LISTEN\)`)
)

// DetectPortForPID inspects process sockets and log output to find the listening port.
func DetectPortForPID(ctx context.Context, pid int, projectPath, logFile string) (int, string) {
	if pid <= 0 && logFile == "" {
		return 0, ""
	}

	// 1. Gather all related PIDs (pid, child pids)
	pids := make(map[int]bool)
	if pid > 0 {
		pids[pid] = true
		// Find child processes via pgrep -P
		if out, err := RunLogCommand(ctx, fmt.Sprintf("pgrep -P %d 2>/dev/null", pid)); err == nil {
			for _, l := range strings.Fields(out) {
				if childPid, err := strconv.Atoi(l); err == nil && childPid > 0 {
					pids[childPid] = true
					// Check grandchildren
					if gOut, gErr := RunLogCommand(ctx, fmt.Sprintf("pgrep -P %d 2>/dev/null", childPid)); gErr == nil {
						for _, gl := range strings.Fields(gOut) {
							if gPid, err := strconv.Atoi(gl); err == nil && gPid > 0 {
								pids[gPid] = true
							}
						}
					}
				}
			}
		}
	}

	// 2. Query listening TCP ports for these PIDs via lsof
	if len(pids) > 0 && runtime.GOOS != "windows" {
		var pidStrs []string
		for p := range pids {
			pidStrs = append(pidStrs, strconv.Itoa(p))
		}
		cmdStr := fmt.Sprintf("lsof -Pan -p %s -iTCP -sTCP:LISTEN 2>/dev/null", strings.Join(pidStrs, ","))
		if out, err := RunLogCommand(ctx, cmdStr); err == nil && strings.TrimSpace(out) != "" {
			var candidatePorts []int
			for _, line := range strings.Split(out, "\n") {
				matches := listenSocketRe.FindStringSubmatch(line)
				if len(matches) > 1 {
					if portNum, err := strconv.Atoi(matches[1]); err == nil && portNum > 0 && portNum <= 65535 {
						// Skip system/database ports unless specifically expected
						if portNum != 3306 && portNum != 22 && portNum != 5432 && portNum != 6379 {
							candidatePorts = append(candidatePorts, portNum)
						}
					}
				}
			}
			if len(candidatePorts) > 0 {
				bestPort := pickBestDevPort(candidatePorts)
				return bestPort, fmt.Sprintf("http://localhost:%d", bestPort)
			}
		}
	}

	// 3. Scan log file for URL or port patterns
	if logFile != "" {
		if content, err := ReadFileTail(logFile, 60); err == nil && content != "" {
			if matches := urlLogRe.FindStringSubmatch(content); len(matches) > 1 {
				if portNum, err := strconv.Atoi(matches[1]); err == nil && portNum > 0 {
					return portNum, fmt.Sprintf("http://localhost:%d", portNum)
				}
			}
			if matches := portLogRe.FindStringSubmatch(content); len(matches) > 1 {
				if portNum, err := strconv.Atoi(matches[1]); err == nil && portNum > 0 {
					return portNum, fmt.Sprintf("http://localhost:%d", portNum)
				}
			}
		}
	}

	return 0, ""
}

func pickBestDevPort(ports []int) int {
	if len(ports) == 0 {
		return 0
	}
	// Preferred standard dev ports
	preferred := []int{3000, 3001, 3002, 5173, 5174, 8000, 8080, 8081, 4200, 4000, 5000}
	for _, p := range preferred {
		for _, candidate := range ports {
			if candidate == p {
				return candidate
			}
		}
	}
	return ports[0]
}

// ─── helpers ────────────────────────────────────────────────────────────────

func killProcessTree(ctx context.Context, pid int) {
	if runtime.GOOS == "windows" {
		_, _ = RunLogCommand(ctx, fmt.Sprintf("taskkill /PID %d /F /T 2>nul", pid))
	} else {
		// Kill process group
		_, _ = RunLogCommand(ctx, fmt.Sprintf("kill -TERM -%d 2>/dev/null; kill -KILL -%d 2>/dev/null; kill -TERM %d 2>/dev/null; kill -KILL %d 2>/dev/null", pid, pid, pid, pid))
	}
}

func getProcessCommand(ctx context.Context, pid int) string {
	if runtime.GOOS == "darwin" || runtime.GOOS == "linux" {
		out, _ := RunLogCommand(ctx, fmt.Sprintf("ps -p %d -o args= 2>/dev/null", pid))
		return strings.TrimSpace(out)
	}
	return strconv.Itoa(pid)
}

func guessRuntime(processName string) string {
	name := strings.ToLower(processName)
	switch {
	case strings.Contains(name, "node") || strings.Contains(name, "npm") || strings.Contains(name, "next"):
		return "node"
	case strings.Contains(name, "python"):
		return "python"
	case strings.Contains(name, "ruby") || strings.Contains(name, "rails"):
		return "ruby"
	case strings.Contains(name, "go"):
		return "go"
	case strings.Contains(name, "java"):
		return "java"
	case strings.Contains(name, "php"):
		return "php"
	default:
		return "unknown"
	}
}

func guessRuntimeFromCmd(cmd string) string {
	return guessRuntime(cmd)
}

func isSystemProcess(name string) bool {
	systemProcs := []string{
		"kernel", "launchd", "systemd", "kextd", "configd", "mds",
		"coreaudiod", "Spotlight", "loginwindow", "Finder", "Dock",
		"WindowServer", "mdworker", "distnoted", "notifyd",
		"lsof", "sh", "bash", "zsh", "ps", "grep", "awk",
	}
	nameLower := strings.ToLower(name)
	for _, s := range systemProcs {
		if strings.EqualFold(s, nameLower) {
			return true
		}
	}
	return false
}

func suggestLogFile(projectPath string, pid int) string {
	safeName := regexp.MustCompile(`[^a-zA-Z0-9_-]`).ReplaceAllString(filepath.Base(projectPath), "_")
	return filepath.Join(os.TempDir(), fmt.Sprintf("ray_monitor_%s_%d.log", safeName, pid))
}

// DetectStartCommand guesses the best start command for a project.
func DetectStartCommand(projectPath string) string {
	checks := []struct {
		file string
		cmd  string
	}{
		{"package.json", "npm run dev"},
		{"requirements.txt", "python -m flask run"},
		{"Pipfile", "pipenv run python manage.py runserver"},
		{"manage.py", "python manage.py runserver"},
		{"Gemfile", "bundle exec rails server"},
		{"go.mod", "go run ."},
		{"Cargo.toml", "cargo run"},
		{"docker-compose.yml", "docker compose up"},
		{"docker-compose.yaml", "docker compose up"},
	}

	// Check package.json for scripts.dev or scripts.start
	pkgFile := filepath.Join(projectPath, "package.json")
	if data, err := os.ReadFile(pkgFile); err == nil {
		content := string(data)
		if strings.Contains(content, `"dev"`) {
			return "npm run dev"
		}
		if strings.Contains(content, `"start"`) {
			return "npm start"
		}
	}

	for _, c := range checks {
		if _, err := os.Stat(filepath.Join(projectPath, c.file)); err == nil {
			return c.cmd
		}
	}
	return ""
}

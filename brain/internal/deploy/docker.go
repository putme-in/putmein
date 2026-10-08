package deploy

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"brain/server/internal/agent"
	"brain/server/internal/monitor"
	"brain/server/internal/security"
)

// DeployStep represents the current stage of deployment.
type DeployStep string

const (
	StepSourceCheck DeployStep = "source_check"
	StepDockerize   DeployStep = "dockerize"
	StepBuilding    DeployStep = "building"
	StepLaunching   DeployStep = "launching"
	StepHealthcheck DeployStep = "healthcheck"
	StepMonitor     DeployStep = "monitoring"
	StepComplete    DeployStep = "complete"
	StepFailed      DeployStep = "failed"
)

// DeployStepEvent is sent over SSE during the deployment process.
type DeployStepEvent struct {
	ActiveDeploymentID string `json:"activeDeploymentId,omitempty"`
	RuntimeRestored    bool   `json:"runtimeRestored,omitempty"`
	SecurityOverridden bool   `json:"securityOverridden,omitempty"`
	SecurityStatus     string `json:"securityStatus,omitempty"`
	ScanID             string `json:"scanId,omitempty"`

	Runtime       string     `json:"runtime,omitempty"`
	ManagedPID    int        `json:"managedPid,omitempty"`
	LogFile       string     `json:"logFile,omitempty"`
	ProjectPath   string     `json:"projectPath,omitempty"`
	ContainerPort int        `json:"containerPort,omitempty"`
	Step          DeployStep `json:"step"`
	Status        string     `json:"status"` // "pending" | "running" | "success" | "error"
	Message       string     `json:"message"`
	LogDelta      string     `json:"logDelta,omitempty"`
	Port          int        `json:"port,omitempty"`
	URL           string     `json:"url,omitempty"`
	Container     string     `json:"container,omitempty"`
}

// DeployRequest holds input configuration for a container deployment.
type DeployRequest struct {
	SourceReference  string      `json:"sourceReference,omitempty"`
	HealthCheck      HealthCheck `json:"healthCheck"`
	RoutingMode      string      `json:"routingMode,omitempty"`
	ProjectURL       string      `json:"projectUrl,omitempty"`
	SecurityOverride string      `json:"securityOverride,omitempty"`
	skipBuild        bool
	sourcePrepared   bool

	DockerEnabled   *bool             `json:"dockerEnabled,omitempty"`
	ProjectID       string            `json:"projectId,omitempty"`
	PreviousRuntime string            `json:"previousRuntime,omitempty"`
	Framework       string            `json:"framework,omitempty"`
	BuildCommand    string            `json:"buildCommand,omitempty"`
	StartCommand    string            `json:"startCommand,omitempty"`
	ContainerPort   int               `json:"containerPort,omitempty"`
	ID              string            `json:"id"`
	UserID          string            `json:"userId"`
	Name            string            `json:"name"`
	ProjectPath     string            `json:"projectPath"`
	SourceType      string            `json:"sourceType"` // "upload" | "github" | "local"
	RepoURL         string            `json:"repoUrl,omitempty"`
	Branch          string            `json:"branch,omitempty"`
	GitHubToken     string            `json:"githubToken,omitempty"`
	EnvVars         map[string]string `json:"envVars,omitempty"`
	HostPort        int               `json:"hostPort,omitempty"`
}

// DeployResult is returned when deployment completes.
type DeployResult struct {
	Runtime        string `json:"runtime,omitempty"`
	ManagedPID     int    `json:"managedPid,omitempty"`
	ManagedLogFile string `json:"managedLogFile,omitempty"`
	DeploymentID   string `json:"deploymentId"`
	ProjectID      string `json:"projectId,omitempty"`
	Name           string `json:"name"`
	ContainerID    string `json:"containerId"`
	ContainerName  string `json:"containerName"`
	ImageName      string `json:"imageName"`
	HostPort       int    `json:"hostPort"`
	ContainerPort  int    `json:"containerPort"`
	DeployURL      string `json:"deployUrl"`
	Status         string `json:"status"`
	BuildLogs      string `json:"buildLogs"`
}

// In-memory registry of active deployments
var (
	deployMu    sync.Mutex
	deployments = make(map[string]*DeployResult)
)

// Reserved platform and system database ports that must never be allocated to containers.
var ReservedPorts = map[int]string{
	3000:  "Ray Dashboard (Core Platform)",
	3100:  "Brain AI Backend (Core Platform)",
	3306:  "MySQL / MariaDB",
	5432:  "PostgreSQL",
	6379:  "Redis",
	27017: "MongoDB",
}

func init() {
	if rp := os.Getenv("RAY_PORT"); rp != "" {
		if p, err := strconv.Atoi(rp); err == nil && p > 0 {
			ReservedPorts[p] = "Ray Dashboard (Live)"
		}
	}
	if bp := os.Getenv("BRAIN_PORT"); bp != "" {
		if p, err := strconv.Atoi(bp); err == nil && p > 0 {
			ReservedPorts[p] = "Brain AI Backend (Live)"
		}
	}
}

// isSocketFree tests if a port is truly available across wildcard, 0.0.0.0, and 127.0.0.1 interfaces.
// Each socket is tested and immediately closed to verify clean bindability.
func isSocketFree(port int) bool {
	if _, isReserved := ReservedPorts[port]; isReserved {
		return false
	}

	// 1. Wildcard interface (binds 0.0.0.0 and [::])
	lnWildcard, err1 := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err1 != nil {
		return false
	}
	_ = lnWildcard.Close()

	// 2. Explicit 0.0.0.0 interface (Docker container bindings)
	lnZero, err2 := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", port))
	if err2 != nil {
		return false
	}
	_ = lnZero.Close()

	// 3. Explicit 127.0.0.1 interface
	lnLocal, err3 := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err3 != nil {
		return false
	}
	_ = lnLocal.Close()

	return true
}

// GetUsedPortsMap aggregates all ports currently claimed by:
// 1. Ray Dashboard projects, deployments, and pipelines (via Ray API /api/ports)
// 2. Live Docker containers (via docker ps)
// 3. System listening TCP sockets (via lsof)
// 4. Core platform reserved ports (3000, 3100, databases)
func GetUsedPortsMap() (map[int]string, error) {
	claimed := make(map[int]string)

	// Add reserved ports
	for p, desc := range ReservedPorts {
		claimed[p] = desc
	}

	if routes, err := readRoutes(); err == nil {
		for _, route := range routes {
			if route.Port > 0 {
				claimed[route.Port] = "managed domain " + route.Host
			}
		}
	}
	// 1. In-memory monitored projects from monitor.Global (no HTTP call needed)
	if monitor.Global != nil {
		for _, p := range monitor.Global.ListProjects() {
			if p.ProjectUrl != "" {
				portRe := regexp.MustCompile(`:(\d+)`)
				if m := portRe.FindStringSubmatch(p.ProjectUrl); len(m) > 1 {
					if portNum, err := strconv.Atoi(m[1]); err == nil && portNum > 0 {
						claimed[portNum] = fmt.Sprintf("%s (monitored project)", p.Name)
					}
				}
			}
		}
	}

	// 2. Local Docker container inspection (docker ps -a)
	if out, err := monitor.RunLogCommand(context.Background(), `docker ps -a --format "{{.Ports}}\t{{.Names}}"`); err == nil {
		portRe := regexp.MustCompile(`(?::|0\.0\.0\.0:)(\d+)->`)
		for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
			parts := strings.Split(line, "\t")
			if len(parts) >= 2 {
				portsStr := parts[0]
				cName := parts[1]
				cleanName := strings.TrimPrefix(cName, "ray-")
				for _, m := range portRe.FindAllStringSubmatch(portsStr, -1) {
					if len(m) > 1 {
						if p, pErr := strconv.Atoi(m[1]); pErr == nil && p > 0 {
							claimed[p] = fmt.Sprintf("%s (container %s)", cleanName, cName)
						}
					}
				}
			}
		}
	}

	// 3. Host system listening sockets (lsof -iTCP -sTCP:LISTEN -P -n)
	if lsofOut, err := monitor.RunLogCommand(context.Background(), "lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null"); err == nil {
		lines := strings.Split(lsofOut, "\n")
		for _, line := range lines {
			fields := strings.Fields(line)
			if len(fields) >= 9 {
				cmdName := fields[0]
				target := fields[8]
				if idx := strings.LastIndex(target, ":"); idx != -1 {
					if p, pErr := strconv.Atoi(target[idx+1:]); pErr == nil && p > 0 {
						if _, exists := claimed[p]; !exists {
							claimed[p] = fmt.Sprintf("system process %s", cmdName)
						}
					}
				}
			}
		}
	}

	return claimed, nil
}

// FindGuaranteedFreePortWithClaimed finds a host port using a pre-resolved claimed map
// so it does not re-run socket/process scans when looking for multiple candidate free ports.
func FindGuaranteedFreePortWithClaimed(preferredPort int, excludeProject string, claimed map[int]string) (int, error) {
	if claimed == nil {
		var err error
		claimed, err = GetUsedPortsMap()
		if err != nil {
			return 0, err
		}
	}

	// If a preferred port was explicitly requested, check if it's safe to use
	if preferredPort > 0 {
		_, isReserved := ReservedPorts[preferredPort]
		owner, isClaimed := claimed[preferredPort]

		// Allow reusing if current container already owns it
		isSelfOwner := false
		if excludeProject != "" && isClaimed {
			cleanOwner := strings.ToLower(owner)
			cleanSelf := strings.ToLower(excludeProject)
			if strings.Contains(cleanOwner, cleanSelf) || cleanOwner == cleanSelf {
				isSelfOwner = true
			}
		}

		if (!isClaimed || isSelfOwner) && !isReserved && isSocketFree(preferredPort) {
			return preferredPort, nil
		}
	}

	// Search for the next free port in range 4000 to 5999
	for port := 4000; port < 6000; port++ {
		if _, exists := claimed[port]; exists {
			continue
		}
		if isSocketFree(port) {
			return port, nil
		}
	}

	return 0, fmt.Errorf("no free ports available in range 4000-6000 across dashboard and host system")
}

// FindGuaranteedFreePort finds a host port that is guaranteed 100% free and unallocated.
func FindGuaranteedFreePort(preferredPort int, excludeProject string) (int, error) {
	return FindGuaranteedFreePortWithClaimed(preferredPort, excludeProject, nil)
}

// FindFreePort provides backwards-compatible port search using the guaranteed engine.
func FindFreePort(startPort int) (int, error) {
	return FindGuaranteedFreePort(startPort, "")
}

// SanitizeContainerName cleans names for Docker compatibility ([a-zA-Z0-9_.-]).
func SanitizeContainerName(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	var sb strings.Builder
	for _, ch := range name {
		if (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' {
			sb.WriteRune(ch)
		} else {
			sb.WriteRune('-')
		}
	}
	res := strings.Trim(sb.String(), "-_")
	if res == "" {
		res = fmt.Sprintf("app-%d", time.Now().Unix()%10000)
	}
	return "ray-" + res
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// ExecuteDeployment runs the complete containerized deployment workflow.
func executeDeployment(ctx context.Context, req DeployRequest, emit func(DeployStepEvent)) (deploymentResult *DeployResult, deploymentErr error) {
	hostMode := req.DockerEnabled != nil && !*req.DockerEnabled
	if req.PreviousRuntime != "" && strings.HasPrefix(req.PreviousRuntime, hostPrefix) != hostMode {
		running := false
		if strings.HasPrefix(req.PreviousRuntime, hostPrefix) {
			state, err := readHostState(req.PreviousRuntime)
			if err != nil && !os.IsNotExist(err) {
				return nil, err
			}
			running = state != nil && hostProcessAlive(state.PID, state.Marker)
		} else {
			out, err := dockerCmd(ctx, "inspect", "--format", "{{.State.Running}}", req.PreviousRuntime).Output()
			if err == nil {
				running = strings.TrimSpace(string(out)) == "true"
			}
		}
		if running {
			return nil, fmt.Errorf("stop the current deployment before switching between Docker and host execution")
		}
	}
	if hostMode {
		return executeHostDeployment(ctx, req, emit)
	}
	if req.ContainerPort < 0 || req.ContainerPort > 65535 || req.HostPort < 0 || req.HostPort > 65535 {
		return nil, fmt.Errorf("ports must be between 1 and 65535, or omitted for automatic allocation")
	}
	containerName := SanitizeContainerName(req.Name)
	imageName := fmt.Sprintf("%s:release-%d", containerName, time.Now().UnixNano())
	defer func() {
		if deploymentErr != nil {
			_ = recordArtifact(req, &DeployResult{ContainerName: containerName, ImageName: imageName}, "failed")
		}
	}()

	// Resolve project path against configured base deployments directory
	resolvedPath := req.ProjectPath
	if resolvedPath == "" {
		resolvedPath = filepath.Join(agent.GetDeploymentsDir(), containerName)
	} else if !filepath.IsAbs(resolvedPath) {
		candidate := filepath.Join(agent.GetDeploymentsDir(), resolvedPath)
		if _, err := os.Stat(candidate); err == nil {
			resolvedPath = candidate
		}
	} else if _, err := os.Stat(resolvedPath); os.IsNotExist(err) {
		candidate := filepath.Join(agent.GetDeploymentsDir(), filepath.Base(resolvedPath))
		if _, err := os.Stat(candidate); err == nil {
			resolvedPath = candidate
		}
	}
	req.ProjectPath = resolvedPath

	// ── STEP 1: Source Validation ──
	emit(DeployStepEvent{
		Step:    StepSourceCheck,
		Status:  "running",
		Message: fmt.Sprintf("Validating project workspace at %s", req.ProjectPath),
	})

	if _, err := os.Stat(req.ProjectPath); os.IsNotExist(err) {
		emit(DeployStepEvent{
			Step:    StepSourceCheck,
			Status:  "error",
			Message: fmt.Sprintf("Project directory does not exist: %s", req.ProjectPath),
		})
		return nil, fmt.Errorf("project path does not exist: %s", req.ProjectPath)
	}

	emit(DeployStepEvent{
		Step:    StepSourceCheck,
		Status:  "success",
		Message: "Source verified successfully",
	})

	// ── STEP 2: Dockerfile Generation & Inspection ──
	emit(DeployStepEvent{
		Step:    StepDockerize,
		Status:  "running",
		Message: "Analyzing framework & generating optimized container spec",
	})

	dockerfileContent, containerPort, err := DetectAndGenerateDockerfile(req.ProjectPath, req)
	if err != nil {
		emit(DeployStepEvent{
			Step:    StepDockerize,
			Status:  "error",
			Message: fmt.Sprintf("Failed to generate Dockerfile: %v", err),
		})
		return nil, err
	}

	if req.ContainerPort > 0 {
		containerPort = req.ContainerPort
	}

	if value, ok := req.EnvVars["PORT"]; ok && value != strconv.Itoa(containerPort) {
		return nil, fmt.Errorf("PORT must match the configured application port %d", containerPort)
	}

	emit(DeployStepEvent{
		Step:     StepDockerize,
		Status:   "success",
		Message:  fmt.Sprintf("Container spec configured for port :%d", containerPort),
		LogDelta: dockerfileContent,
	})

	// ── STEP 3: Docker Build ──
	emit(DeployStepEvent{
		Step:    StepBuilding,
		Status:  "running",
		Message: fmt.Sprintf("Building Docker image '%s'...", imageName),
	})

	buildCmd := dockerCmd(ctx, "build", "--label", "io.ray.owner="+req.UserID, "--label", "io.ray.project="+securityIdentity(req), "-t", imageName, ".")
	buildCmd.Dir = req.ProjectPath

	stdout, err := buildCmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to open stdout pipe: %v", err)
	}
	buildCmd.Stderr = buildCmd.Stdout

	if err := buildCmd.Start(); err != nil {
		emit(DeployStepEvent{
			Step:    StepBuilding,
			Status:  "error",
			Message: fmt.Sprintf("Docker build failed to start: %v", err),
		})
		return nil, fmt.Errorf("docker build error: %v", err)
	}

	var buildLogs strings.Builder
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		buildLogs.WriteString(line + "\n")
		emit(DeployStepEvent{
			Step:     StepBuilding,
			Status:   "running",
			LogDelta: line + "\n",
		})
	}

	if err := buildCmd.Wait(); err != nil {
		errMsg := fmt.Sprintf("Docker build failed: %v", err)
		emit(DeployStepEvent{
			Step:     StepBuilding,
			Status:   "error",
			Message:  errMsg,
			LogDelta: fmt.Sprintf("\n[ERROR] %s\n", errMsg),
		})
		emit(DeployStepEvent{
			Step:     StepFailed,
			Status:   "error",
			Message:  errMsg,
			LogDelta: fmt.Sprintf("[DEPLOYMENT FAILED]\n"),
		})
		return nil, fmt.Errorf("docker build failed: %v\nLogs:\n%s", err, buildLogs.String())
	}

	emit(DeployStepEvent{
		Step:    StepBuilding,
		Status:  "success",
		Message: fmt.Sprintf("Docker image '%s' built successfully", imageName),
	})

	runImage := imageName
	if agent.IsSecurityChecksEnabled() {
		policy, policyErr := security.LoadAdvancedConfig()
		if policyErr != nil {
			return nil, policyErr
		}
		if policy.Images {
			imageID, inspectErr := dockerCmd(ctx, "image", "inspect", "--format", "{{.Id}}", imageName).Output()
			report := &security.SecurityReport{ID: fmt.Sprintf("scan_%d", time.Now().UnixNano()), ProjectID: securityIdentity(req), ProjectName: req.Name, Trigger: "image_gate", Status: "passed", CreatedAt: time.Now(), Findings: []security.FindingItem{}}
			scanErr := inspectErr
			if scanErr == nil {
				scanErr = security.ScanImage(ctx, strings.TrimSpace(string(imageID)), report)
			}
			if scanErr != nil {
				report.Status = "error"
				report.Summary = "Image scan incomplete"
				report.Logs = scanErr.Error()
			}
			if err := persistSecurityReport(ctx, req, report); err != nil {
				return nil, err
			}
			emit(DeployStepEvent{Step: "security", Status: "running", SecurityStatus: report.Status, ScanID: report.ID, Message: report.Summary})
			if report.Status == "error" || report.Status == "danger" {
				return nil, fmt.Errorf("image security gate blocked deployment; review scan %s", report.ID)
			}
			runImage = strings.TrimSpace(string(imageID))
		}
	}

	// ── STEP 4: Container Launch ──
	emit(DeployStepEvent{
		Step:    StepLaunching,
		Status:  "running",
		Message: "Allocating host port & starting container...",
	})

	// Resolve conflicts before stopping the previous application. An occupied
	// requested port is reusable only if this exact container currently publishes it.
	hostPort, pErr := selectDeploymentPort(ctx, req.HostPort, req.Name, containerName)
	if pErr != nil {
		return nil, pErr
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	transaction, err := beginDockerReplacement(ctx, req, containerName, imageName)
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			restoreCtx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
			defer cancel()
			if restoreErr := transaction.restore(restoreCtx); restoreErr != nil {
				deploymentErr = fmt.Errorf("%v; rollback incomplete: %w", deploymentErr, restoreErr)
				emit(DeployStepEvent{Step: "rollback", Status: "error", Message: restoreErr.Error()})
			} else {
				message := "Failed candidate removed"
				if transaction.PreviousID != "" {
					message = "Previous container restored"
				}
				event := DeployStepEvent{Step: "rollback", Status: "success", Message: message}
				if transaction.Previous != nil && transaction.WasRunning {
					previous := transaction.Previous
					event.RuntimeRestored = true
					event.ActiveDeploymentID = previous.Request.ID
					event.Port = previous.Result.HostPort
					event.URL = previous.Result.DeployURL
					event.Container = previous.Result.ContainerName
					event.ProjectPath = previous.Request.ProjectPath
				}
				emit(event)
				deploymentErr = fmt.Errorf("%v; %s", deploymentErr, message)
			}
		}
	}()
	if err = transaction.stopPrevious(ctx); err != nil {
		return nil, err
	}

	if !isSocketFree(hostPort) {
		return nil, fmt.Errorf("host port %d became unavailable during replacement", hostPort)
	}

	portBinding := fmt.Sprintf("%d:%d", hostPort, containerPort)
	if req.RoutingMode == "https" {
		portBinding = "127.0.0.1:" + portBinding
	}
	runArgs := []string{
		"run", "-d",
		"--name", containerName,
		"--init",
		"--label", "io.ray.owner=" + req.UserID,
		"--label", "io.ray.project=" + securityIdentity(req),
		"--log-driver", "json-file", "--log-opt", "max-size=10m", "--log-opt", "max-file=3",
		"-p", portBinding,
		"--restart", "unless-stopped",
	}

	runArgs = append(runArgs, "-e", fmt.Sprintf("PORT=%d", containerPort))
	// Add environment variables if provided
	for k, v := range req.EnvVars {
		runArgs = append(runArgs, "-e", fmt.Sprintf("%s=%s", k, v))
	}
	if req.StartCommand != "" {
		runArgs = append(runArgs, "--entrypoint", "/bin/sh")
	}
	runArgs = append(runArgs, runImage)
	if req.StartCommand != "" {
		runArgs = append(runArgs, "-c", req.StartCommand)
	}

	runOut, err := dockerCmd(ctx, runArgs...).CombinedOutput()
	if err != nil {
		errMsg := fmt.Sprintf("Failed to run container: %v\n%s", err, string(runOut))
		emit(DeployStepEvent{
			Step:     StepLaunching,
			Status:   "error",
			Message:  errMsg,
			LogDelta: fmt.Sprintf("\n[ERROR] %s\n", errMsg),
		})
		emit(DeployStepEvent{
			Step:    StepFailed,
			Status:  "error",
			Message: errMsg,
		})
		return nil, fmt.Errorf("docker run error: %v\n%s", err, string(runOut))
	}

	containerID := strings.TrimSpace(string(runOut))

	deployURL := directURL(hostPort)

	emit(DeployStepEvent{
		Step:      StepLaunching,
		Status:    "success",
		Message:   fmt.Sprintf("Container running (ID: %s) on %s (port :%d)", containerID, deployURL, hostPort),
		Port:      hostPort,
		URL:       deployURL,
		Container: containerName,
	})

	// ── STEP 5: Healthcheck ──
	emit(DeployStepEvent{
		Step:    StepHealthcheck,
		Status:  "running",
		Message: fmt.Sprintf("Waiting for container on port :%d to become healthy...", hostPort),
	})

	healthHost, _ := routingHost(req)
	if err := waitForHealth(ctx, hostPort, req.HealthCheck, nil, healthHost); err != nil {
		return nil, err
	}
	emit(DeployStepEvent{Step: StepHealthcheck, Status: "success", Message: "Application passed its configured health check", URL: deployURL})

	deployURL, err = applyRouting(ctx, req, hostPort, containerName)
	if err != nil {
		return nil, fmt.Errorf("application started but routing failed: %w", err)
	}
	if req.RoutingMode == "https" {
		emit(DeployStepEvent{Step: StepHealthcheck, Status: "success", Message: "HTTPS route configured. Certificate issuance depends on DNS and public access to ports 80/443.", URL: deployURL})
	}

	// ── STEP 6: 24/7 Monitor Auto-Registration ──
	emit(DeployStepEvent{
		Step:    StepMonitor,
		Status:  "running",
		Message: "Registering container into 24/7 AI log monitor...",
	})

	if err := monitor.AddContainerProject(req.UserID, req.Name, req.ProjectPath, containerName, 30, req.ProjectID); err != nil {
		emit(DeployStepEvent{
			Step:    StepMonitor,
			Status:  "running",
			Message: fmt.Sprintf("Monitor registration note: %v", err),
		})
	} else {
		emit(DeployStepEvent{
			Step:    StepMonitor,
			Status:  "success",
			Message: "Project added to 24/7 AI anomaly detection monitor",
		})
	}

	// ── STEP 7: Completion ──
	result := &DeployResult{
		DeploymentID:  req.ID,
		Name:          req.Name,
		ContainerID:   containerID,
		ContainerName: containerName,
		ImageName:     imageName,
		HostPort:      hostPort,
		ContainerPort: containerPort,
		DeployURL:     deployURL,
		Status:        "healthy",
		BuildLogs:     buildLogs.String(),
	}

	if err = transaction.commit(result); err != nil {
		return nil, fmt.Errorf("could not commit release state: %w", err)
	}
	committed = true

	deployMu.Lock()
	deployments[containerName] = result
	deployMu.Unlock()

	// Sync deployment record to Ray database
	SaveDeploymentViaRayAPI(result, req)

	emit(DeployStepEvent{
		ProjectPath:   req.ProjectPath,
		ContainerPort: containerPort,
		Step:          StepComplete,
		Status:        "success",
		Message:       fmt.Sprintf("Application successfully deployed at %s", deployURL),
		Port:          hostPort,
		URL:           deployURL,
		Container:     containerName,
	})

	return result, nil
}

// SaveDeploymentViaRayAPI persists the deployment record into Ray's database via internal endpoint.
func SaveDeploymentViaRayAPI(res *DeployResult, req DeployRequest) {
	rayURL := os.Getenv("RAY_URL")
	if rayURL == "" {
		rayURL = "http://localhost:3000"
	}
	secret := os.Getenv("BRAIN_INTERNAL_SECRET")
	if secret == "" {
		fmt.Printf("[deploy] BRAIN_INTERNAL_SECRET not set, cannot save deployment via Ray API\n")
		return
	}

	payload, err := json.Marshal(map[string]any{
		"id":             req.ID,
		"projectId":      req.ProjectID,
		"runtime":        res.Runtime,
		"managedPid":     res.ManagedPID,
		"managedLogFile": res.ManagedLogFile,
		"userId":         req.UserID,
		"name":           res.Name,
		"projectPath":    req.ProjectPath,
		"containerName":  res.ContainerName,
		"containerId":    res.ContainerID,
		"imageName":      res.ImageName,
		"hostPort":       res.HostPort,
		"containerPort":  res.ContainerPort,
		"deployUrl":      res.DeployURL,
		"status":         res.Status,
		"buildLogs":      res.BuildLogs,
		"sourceType":     req.SourceType,
		"repoUrl":        req.RepoURL,
		"branch":         req.Branch,
	})
	if err != nil {
		return
	}

	httpReq, err := http.NewRequest("POST", rayURL+"/api/deployments/internal/save-deployment", bytes.NewReader(payload))
	if err != nil {
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-brain-secret", secret)

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(httpReq)
	if err == nil {
		_ = resp.Body.Close()
	}
}

// ResolveDockerEnv resolves the environment variables for Docker CLI execution on a given OS.
// On Windows, if DOCKER_HOST is not set or points to the obsolete dockerDesktopLinuxEngine pipe,
// it defaults to the official Docker Desktop engine pipe npipe:////./pipe/docker_engine.
func ResolveDockerEnv(currentEnv []string, targetOS string) []string {
	if targetOS != "windows" {
		return currentEnv
	}
	const defaultWinPipe = "npipe:////./pipe/docker_engine"
	hasHost := false
	out := make([]string, len(currentEnv))
	copy(out, currentEnv)

	for i, kv := range out {
		if strings.HasPrefix(strings.ToUpper(kv), "DOCKER_HOST=") {
			val := kv[len("DOCKER_HOST="):]
			if val == "" || strings.Contains(val, "dockerDesktopLinuxEngine") {
				out[i] = "DOCKER_HOST=" + defaultWinPipe
			}
			hasHost = true
			break
		}
	}
	if !hasHost {
		out = append(out, "DOCKER_HOST="+defaultWinPipe)
	}
	return out
}

func getDockerEnv() []string {
	return ResolveDockerEnv(os.Environ(), runtime.GOOS)
}

func dockerCmd(ctx context.Context, args ...string) *exec.Cmd {
	var cmd *exec.Cmd
	if ctx != nil {
		cmd = exec.CommandContext(ctx, "docker", args...)
	} else {
		cmd = exec.Command("docker", args...)
	}
	cmd.Env = getDockerEnv()
	return cmd
}

// GetContainerLogs returns recent logs from the docker container.
func GetContainerLogs(containerName string, lines int) (string, error) {
	if strings.HasPrefix(containerName, hostPrefix) {
		return HostRuntimeLogs(containerName, lines)
	}
	if lines <= 0 {
		lines = 200
	}
	cmd := dockerCmd(nil, "logs", "--tail", strconv.Itoa(lines), containerName)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// StopContainer stops and removes a container.
func StopContainer(containerName string) error {
	cancelActiveRuntime(containerName)
	if strings.HasPrefix(containerName, hostPrefix) {
		return StopHostRuntime(containerName)
	}
	if err := removeRuntimeRoute(containerName); err != nil {
		return err
	}
	cmd := dockerCmd(nil, "rm", "-f", containerName)
	return cmd.Run()
}

// RestartContainer restarts a container.
func RestartContainer(containerName string) error {
	if strings.HasPrefix(containerName, hostPrefix) {
		return RestartHostRuntime(containerName)
	}
	cmd := dockerCmd(nil, "restart", containerName)
	return cmd.Run()
}

func selectDeploymentPort(ctx context.Context, preferred int, name, container string) (int, error) {
	if preferred == 0 {
		return FindGuaranteedFreePort(0, name)
	}
	if preferred < 1 || preferred > 65535 {
		return 0, fmt.Errorf("invalid host port")
	}
	if _, reserved := ReservedPorts[preferred]; reserved || preferred == 4500 || preferred == 4567 {
		return 0, fmt.Errorf("host port %d is reserved", preferred)
	}
	if err := ensureRoutePortAvailable(preferred, container); err != nil {
		return 0, err
	}
	if isSocketFree(preferred) {
		return preferred, nil
	}
	raw, err := dockerCmd(ctx, "inspect", "--format", "{{json .NetworkSettings.Ports}}", container).Output()
	if err == nil {
		var bindings map[string][]struct {
			HostPort string `json:"HostPort"`
		}
		if json.Unmarshal(raw, &bindings) == nil {
			for _, ports := range bindings {
				for _, port := range ports {
					if port.HostPort == strconv.Itoa(preferred) {
						return preferred, nil
					}
				}
			}
		}
	}
	return 0, fmt.Errorf("requested host port %d is occupied; choose another port or automatic allocation", preferred)
}

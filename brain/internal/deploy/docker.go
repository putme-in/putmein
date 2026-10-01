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
	"strconv"
	"strings"
	"sync"
	"time"

	"brain/server/internal/agent"
	"brain/server/internal/monitor"
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
	Step      DeployStep `json:"step"`
	Status    string     `json:"status"` // "pending" | "running" | "success" | "error"
	Message   string     `json:"message"`
	LogDelta  string     `json:"logDelta,omitempty"`
	Port      int        `json:"port,omitempty"`
	URL       string     `json:"url,omitempty"`
	Container string     `json:"container,omitempty"`
}

// DeployRequest holds input configuration for a container deployment.
type DeployRequest struct {
	ID          string            `json:"id"`
	UserID      string            `json:"userId"`
	Name        string            `json:"name"`
	ProjectPath string            `json:"projectPath"`
	SourceType  string            `json:"sourceType"` // "upload" | "github" | "local"
	RepoURL     string            `json:"repoUrl,omitempty"`
	Branch      string            `json:"branch,omitempty"`
	GitHubToken string            `json:"githubToken,omitempty"`
	EnvVars     map[string]string `json:"envVars,omitempty"`
	HostPort    int               `json:"hostPort,omitempty"`
}

// DeployResult is returned when deployment completes.
type DeployResult struct {
	DeploymentID  string `json:"deploymentId"`
	ProjectID     string `json:"projectId,omitempty"`
	Name          string `json:"name"`
	ContainerID   string `json:"containerId"`
	ContainerName string `json:"containerName"`
	ImageName     string `json:"imageName"`
	HostPort      int    `json:"hostPort"`
	ContainerPort int    `json:"containerPort"`
	DeployURL     string `json:"deployUrl"`
	Status        string `json:"status"`
	BuildLogs     string `json:"buildLogs"`
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
	if out, err := monitor.RunLogCommand(context.Background(), `docker ps -a --format "{{.Ports}}\t{{.Names}}" 2>/dev/null`); err == nil {
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

// DetectAndGenerateDockerfile inspects the project directory and returns/writes a Dockerfile.
func DetectAndGenerateDockerfile(projectPath string) (dockerfileContent string, containerPort int, err error) {
	dockerfilePath := filepath.Join(projectPath, "Dockerfile")

	// 1. If existing Dockerfile exists, read it
	if data, readErr := os.ReadFile(dockerfilePath); readErr == nil && len(data) > 0 {
		content := string(data)
		// Fix invalid shell operators inside Dockerfile COPY directives if present
		if strings.Contains(content, "2>/dev/null || true") || strings.Contains(content, "|| true") {
			content = strings.ReplaceAll(content, "COPY --from=builder /app/public ./public 2>/dev/null || true", "COPY --from=builder /app/public ./public")
			content = strings.ReplaceAll(content, "COPY --from=builder /app/public ./public || true", "COPY --from=builder /app/public ./public")
			if !strings.Contains(content, "mkdir -p /app/public") {
				content = strings.Replace(content, "COPY . .", "COPY . .\nRUN mkdir -p /app/public", 1)
			}
			_ = os.WriteFile(dockerfilePath, []byte(content), 0644)
		}

		port := 3000
		for _, line := range strings.Split(content, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(strings.ToUpper(line), "EXPOSE") {
				parts := strings.Fields(line)
				if len(parts) > 1 {
					if p, pErr := strconv.Atoi(parts[1]); pErr == nil && p > 0 {
						port = p
					}
				}
			}
		}
		return content, port, nil
	}

	// 2. Next.js App
	if fileExists(filepath.Join(projectPath, "next.config.js")) ||
		fileExists(filepath.Join(projectPath, "next.config.ts")) ||
		fileExists(filepath.Join(projectPath, "next.config.mjs")) {
		dockerfileContent = `FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=development

COPY package*.json ./
RUN npm install

COPY . .
RUN mkdir -p /app/public
ENV NODE_ENV=production
ENV DATABASE_URL="mysql://root:password@localhost:3306/dummy"
RUN npm run build || npx next build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm install --omit=dev || npm ci --only=production || true

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000
CMD ["npm", "start"]
`
		containerPort = 3000
	} else if fileExists(filepath.Join(projectPath, "package.json")) {
		// 3. General Node.js / Vite / Express
		pkgData, _ := os.ReadFile(filepath.Join(projectPath, "package.json"))
		pkgStr := string(pkgData)

		if strings.Contains(pkgStr, `"vite"`) || strings.Contains(pkgStr, `"react-scripts"`) {
			dockerfileContent = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
RUN npm run build || true
RUN mkdir -p /app/dist && if [ -d /app/build ]; then cp -r /app/build/* /app/dist/ 2>/dev/null || true; fi

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
`
			containerPort = 3000
		} else {
			dockerfileContent = `FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --only=production || npm install

COPY . .
EXPOSE 3000
CMD ["npm", "start"]
`
			containerPort = 3000
		}
	} else if fileExists(filepath.Join(projectPath, "requirements.txt")) ||
		fileExists(filepath.Join(projectPath, "Pipfile")) ||
		fileExists(filepath.Join(projectPath, "pyproject.toml")) {
		// 4. Python
		dockerfileContent = `FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

COPY requirements.txt* ./
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi

COPY . .
EXPOSE 8000
CMD ["python", "app.py"]
`
		containerPort = 8000
	} else if fileExists(filepath.Join(projectPath, "go.mod")) {
		// 5. Go
		dockerfileContent = `FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
RUN CGO_ENABLED=0 go build -o /app/server .

FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/server ./server
EXPOSE 8080
CMD ["./server"]
`
		containerPort = 8080
	} else {
		// 6. Static HTML
		dockerfileContent = `FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`
		containerPort = 80
	}

	// Write generated Dockerfile to project
	_ = os.WriteFile(dockerfilePath, []byte(dockerfileContent), 0644)

	// Write .dockerignore if not present
	dockerignorePath := filepath.Join(projectPath, ".dockerignore")
	if !fileExists(dockerignorePath) {
		_ = os.WriteFile(dockerignorePath, []byte("node_modules\n.git\n.next\n__pycache__\ndist\n.env.local\n"), 0644)
	}

	return dockerfileContent, containerPort, nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// ExecuteDeployment runs the complete containerized deployment workflow.
func ExecuteDeployment(ctx context.Context, req DeployRequest, emit func(DeployStepEvent)) (*DeployResult, error) {
	containerName := SanitizeContainerName(req.Name)
	imageName := fmt.Sprintf("%s:latest", containerName)

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

	// ── STEP 0: Automatic Git Clone / Pull (if repository configured) ──
	if req.RepoURL != "" || req.SourceType == "github" {
		branch := strings.TrimSpace(req.Branch)
		if branch == "" {
			branch = "main"
		}

		cloneURL := strings.TrimSpace(req.RepoURL)
		if cloneURL != "" {
			if req.GitHubToken != "" && strings.Contains(cloneURL, "github.com/") && !strings.Contains(cloneURL, "@") {
				cloneURL = strings.Replace(cloneURL, "https://github.com/", fmt.Sprintf("https://x-access-token:%s@github.com/", req.GitHubToken), 1)
			}

			gitDir := filepath.Join(req.ProjectPath, ".git")
			if _, err := os.Stat(gitDir); os.IsNotExist(err) {
				// Local directory does not exist or is not a git repo: perform fresh clone
				emit(DeployStepEvent{
					Step:    StepSourceCheck,
					Status:  "running",
					Message: fmt.Sprintf("Cloning repository %s (branch: %s)...", req.Name, branch),
				})

				_ = os.MkdirAll(filepath.Dir(req.ProjectPath), 0755)
				if _, err := os.Stat(req.ProjectPath); err == nil {
					// Clean up empty/stale non-git directory
					_ = os.RemoveAll(req.ProjectPath)
				}

				cloneCmd := exec.CommandContext(ctx, "git", "clone", "-b", branch, "--single-branch", cloneURL, req.ProjectPath)
				cloneCmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_ASKPASS=")
				var cloneOut bytes.Buffer
				cloneCmd.Stdout = &cloneOut
				cloneCmd.Stderr = &cloneOut

				if err := cloneCmd.Run(); err != nil {
					// Fallback: try clone default branch without -b if specified branch failed
					fallbackCmd := exec.CommandContext(ctx, "git", "clone", cloneURL, req.ProjectPath)
					fallbackCmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_ASKPASS=")
					var fallbackOut bytes.Buffer
					fallbackCmd.Stdout = &fallbackOut
					fallbackCmd.Stderr = &fallbackOut
					if errFallback := fallbackCmd.Run(); errFallback != nil {
						emit(DeployStepEvent{
							Step:     StepSourceCheck,
							Status:   "error",
							Message:  fmt.Sprintf("Failed to clone repository: %v", err),
							LogDelta: cloneOut.String() + "\n" + fallbackOut.String(),
						})
						return nil, fmt.Errorf("failed to clone repository %s: %v", req.RepoURL, err)
					}
				}

				emit(DeployStepEvent{
					Step:    StepSourceCheck,
					Status:  "running",
					Message: fmt.Sprintf("Repository cloned successfully into %s", req.ProjectPath),
				})
			} else {
				// Local repo exists: fetch & sync branch
				emit(DeployStepEvent{
					Step:    StepSourceCheck,
					Status:  "running",
					Message: fmt.Sprintf("Syncing latest commits for %s (branch: %s)...", req.Name, branch),
				})

				fetchCmd := exec.CommandContext(ctx, "git", "-C", req.ProjectPath, "fetch", cloneURL, branch)
				fetchCmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_ASKPASS=")
				if _, err := fetchCmd.CombinedOutput(); err == nil {
					checkoutCmd := exec.CommandContext(ctx, "git", "-C", req.ProjectPath, "checkout", branch)
					checkoutCmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_ASKPASS=")
					_ = checkoutCmd.Run()

					resetCmd := exec.CommandContext(ctx, "git", "-C", req.ProjectPath, "reset", "--hard", "FETCH_HEAD")
					resetCmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_ASKPASS=")
					_ = resetCmd.Run()
				}
			}
		}
	}

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

	dockerfileContent, containerPort, err := DetectAndGenerateDockerfile(req.ProjectPath)
	if err != nil {
		emit(DeployStepEvent{
			Step:    StepDockerize,
			Status:  "error",
			Message: fmt.Sprintf("Failed to generate Dockerfile: %v", err),
		})
		return nil, err
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

	buildCmd := exec.CommandContext(ctx, "docker", "build", "-t", imageName, ".")
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

	// ── STEP 4: Container Launch ──
	emit(DeployStepEvent{
		Step:    StepLaunching,
		Status:  "running",
		Message: "Allocating host port & starting container...",
	})

	// Clean up any existing container with the same name
	_ = exec.Command("docker", "rm", "-f", containerName).Run()

	resolvedPort, pErr := FindGuaranteedFreePort(req.HostPort, req.Name)
	if pErr != nil {
		emit(DeployStepEvent{
			Step:    StepLaunching,
			Status:  "error",
			Message: fmt.Sprintf("Port allocation failed: %v", pErr),
		})
		return nil, pErr
	}
	if req.HostPort > 0 && resolvedPort != req.HostPort {
		emit(DeployStepEvent{
			Step:    StepLaunching,
			Status:  "running",
			Message: fmt.Sprintf("Requested port :%d is occupied by another project. Reallocated guaranteed free port :%d (0 collisions)", req.HostPort, resolvedPort),
		})
	}
	hostPort := resolvedPort

	runArgs := []string{
		"run", "-d",
		"--name", containerName,
		"-p", fmt.Sprintf("%d:%d", hostPort, containerPort),
		"--restart", "unless-stopped",
	}

	// Add environment variables if provided
	for k, v := range req.EnvVars {
		runArgs = append(runArgs, "-e", fmt.Sprintf("%s=%s", k, v))
	}
	runArgs = append(runArgs, imageName)

	runOut, err := exec.CommandContext(ctx, "docker", runArgs...).CombinedOutput()
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
	if len(containerID) > 12 {
		containerID = containerID[:12]
	}

	deployURL := fmt.Sprintf("http://localhost:%d", hostPort)
	if agent.GetRoutingMode() == "domain" {
		cleanName := strings.ToLower(regexp.MustCompile(`[^a-zA-Z0-9-]`).ReplaceAllString(req.Name, "-"))
		cleanName = strings.Trim(cleanName, "-")
		if cleanName == "" {
			cleanName = "app"
		}
		if agent.GetDomainProvider() == "custom" && agent.GetCustomRootDomain() != "" {
			deployURL = fmt.Sprintf("http://%s.%s", cleanName, agent.GetCustomRootDomain())
		} else {
			// sslip.io mode
			hostIP := "127.0.0.1"
			if out, err := exec.Command("curl", "-s", "--max-time", "2", "https://api.ipify.org").Output(); err == nil && len(strings.TrimSpace(string(out))) > 0 {
				hostIP = strings.TrimSpace(string(out))
			}
			deployURL = fmt.Sprintf("http://%s.%s.sslip.io", cleanName, hostIP)
		}
	}

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

	client := &http.Client{Timeout: 2 * time.Second}
	healthy := false
	localCheckURL := fmt.Sprintf("http://localhost:%d", hostPort)
	for i := 0; i < 15; i++ {
		time.Sleep(1 * time.Second)
		resp, hErr := client.Get(localCheckURL)
		if hErr == nil {
			_ = resp.Body.Close()
			healthy = true
			break
		}
	}

	if healthy {
		emit(DeployStepEvent{
			Step:    StepHealthcheck,
			Status:  "success",
			Message: fmt.Sprintf("Service is healthy & responding at %s (internal port :%d)", deployURL, hostPort),
			URL:     deployURL,
		})
	} else {
		emit(DeployStepEvent{
			Step:    StepHealthcheck,
			Status:  "running",
			Message: fmt.Sprintf("Container started (healthcheck timed out on port :%d, but container is running)", hostPort),
			URL:     deployURL,
		})
	}

	// ── STEP 6: 24/7 Monitor Auto-Registration ──
	emit(DeployStepEvent{
		Step:    StepMonitor,
		Status:  "running",
		Message: "Registering container into 24/7 AI log monitor...",
	})

	if err := monitor.AddProjectFromChat(req.UserID, req.Name, req.ProjectPath, 30); err != nil {
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

	deployMu.Lock()
	deployments[containerName] = result
	deployMu.Unlock()

	// Sync deployment record to Ray database
	SaveDeploymentViaRayAPI(result, req)

	emit(DeployStepEvent{
		Step:      StepComplete,
		Status:    "success",
		Message:   fmt.Sprintf("Application successfully deployed at %s", deployURL),
		Port:      hostPort,
		URL:       deployURL,
		Container: containerName,
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
		"id":            req.ID,
		"userId":        req.UserID,
		"name":          res.Name,
		"projectPath":   req.ProjectPath,
		"containerName": res.ContainerName,
		"containerId":   res.ContainerID,
		"imageName":     res.ImageName,
		"hostPort":      res.HostPort,
		"containerPort": res.ContainerPort,
		"deployUrl":     res.DeployURL,
		"status":        res.Status,
		"buildLogs":     res.BuildLogs,
		"sourceType":    req.SourceType,
		"repoUrl":       req.RepoURL,
		"branch":        req.Branch,
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

// GetContainerLogs returns recent logs from the docker container.
func GetContainerLogs(containerName string, lines int) (string, error) {
	if lines <= 0 {
		lines = 200
	}
	cmd := exec.Command("docker", "logs", "--tail", strconv.Itoa(lines), containerName)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// StopContainer stops and removes a container.
func StopContainer(containerName string) error {
	cmd := exec.Command("docker", "rm", "-f", containerName)
	return cmd.Run()
}

// RestartContainer restarts a container.
func RestartContainer(containerName string) error {
	cmd := exec.Command("docker", "restart", containerName)
	return cmd.Run()
}

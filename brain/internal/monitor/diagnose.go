package monitor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"brain/server/internal/ai"
)

// DiagnosisResult contains the AI-generated diagnosis and actionable fix steps.
type DiagnosisResult struct {
	Summary        string   `json:"summary"`
	RootCause      string   `json:"rootCause"`
	FixSteps       []string `json:"fixSteps"`
	Commands       []string `json:"commands"`
	StartCommand   string   `json:"startCommand"`
	CanAutoFix     bool     `json:"canAutoFix"`
	ProjectContext string   `json:"projectContext,omitempty"`
}

// FixResult contains the output and status of executing the AI-recommended fix.
type FixResult struct {
	Success      bool            `json:"success"`
	Logs         string          `json:"logs"`
	Error        string          `json:"error,omitempty"`
	Spawned      *ManagedProcess `json:"spawned,omitempty"`
	StartCommand string          `json:"startCommand,omitempty"`
}

var jsonObjectRe = regexp.MustCompile(`(?s)\{.*\}`)

// DiagnoseProject inspects the project environment and failure logs, then prompts the AI to diagnose the problem.
func DiagnoseProject(ctx context.Context, modelID, projectPath, command, failureLogs string) (*DiagnosisResult, error) {
	if projectPath == "" && strings.TrimSpace(failureLogs) == "" {
		return nil, fmt.Errorf("projectPath or failure logs are required")
	}

	// 1. Gather project context
	var contextParts []string
	if projectPath != "" {
		contextParts = append(contextParts, fmt.Sprintf("Project Path: %s", projectPath))
	}
	if command != "" {
		contextParts = append(contextParts, fmt.Sprintf("Attempted Start Command: %s", command))
	}

	// Check node_modules & package.json
	hasNodeModules := false
	if projectPath != "" {
		if info, err := os.Stat(filepath.Join(projectPath, "node_modules")); err == nil && info.IsDir() {
			hasNodeModules = true
		}
		contextParts = append(contextParts, fmt.Sprintf("Has node_modules directory: %v", hasNodeModules))

		// Check package.json
		pkgPath := filepath.Join(projectPath, "package.json")
		if data, err := os.ReadFile(pkgPath); err == nil {
			contextParts = append(contextParts, fmt.Sprintf("package.json contents:\n%s", string(data)))
		}

		// Check lockfiles
		for _, lock := range []string{"package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"} {
			if _, err := os.Stat(filepath.Join(projectPath, lock)); err == nil {
				contextParts = append(contextParts, fmt.Sprintf("Detected lockfile: %s", lock))
			}
		}

		// Check monorepo parent directories
		parentPkgPath := filepath.Join(projectPath, "..", "package.json")
		if data, err := os.ReadFile(parentPkgPath); err == nil {
			contextParts = append(contextParts, fmt.Sprintf("Parent monorepo package.json:\n%s", string(data)))
		}
		grandparentPkgPath := filepath.Join(projectPath, "..", "..", "package.json")
		if data, err := os.ReadFile(grandparentPkgPath); err == nil {
			contextParts = append(contextParts, fmt.Sprintf("Grandparent monorepo package.json:\n%s", string(data)))
		}

		// Check Python files
		if reqData, err := os.ReadFile(filepath.Join(projectPath, "requirements.txt")); err == nil {
			contextParts = append(contextParts, fmt.Sprintf("requirements.txt:\n%s", string(reqData)))
		}
		if pyprojectData, err := os.ReadFile(filepath.Join(projectPath, "pyproject.toml")); err == nil {
			contextParts = append(contextParts, fmt.Sprintf("pyproject.toml:\n%s", string(pyprojectData)))
		}

		// Check Go files
		if goModData, err := os.ReadFile(filepath.Join(projectPath, "go.mod")); err == nil {
			contextParts = append(contextParts, fmt.Sprintf("go.mod:\n%s", string(goModData)))
		}

		// Check Dockerfile
		if dockerData, err := os.ReadFile(filepath.Join(projectPath, "Dockerfile")); err == nil {
			contextParts = append(contextParts, fmt.Sprintf("Dockerfile:\n%s", string(dockerData)))
		}

		// Read recent failure logs from log file if failureLogs is empty
		if strings.TrimSpace(failureLogs) == "" {
			safeName := regexp.MustCompile(`[^a-zA-Z0-9_-]`).ReplaceAllString(filepath.Base(projectPath), "_")
			globPattern := filepath.Join(os.TempDir(), fmt.Sprintf("ray_monitor_%s_*.log", safeName))
			if matches, err := filepath.Glob(globPattern); err == nil && len(matches) > 0 {
				latestLog := matches[len(matches)-1]
				if content, err := ReadFileTail(latestLog, 80); err == nil {
					failureLogs = content
				}
			}
		}
	}

	contextParts = append(contextParts, fmt.Sprintf("Failure Logs:\n%s", failureLogs))
	userPrompt := strings.Join(contextParts, "\n\n")

	// 2. Query AI
	client := ai.NewWithModel(modelID)
	resp := client.Ask(ctx, ai.PromptModeDiagnose, userPrompt, nil)

	var result DiagnosisResult
	parsed := false

	if resp.Err == nil && resp.Text != "" {
		// Clean up markdown block if any
		cleanText := strings.TrimSpace(resp.Text)
		cleanText = strings.TrimPrefix(cleanText, "```json")
		cleanText = strings.TrimPrefix(cleanText, "```")
		cleanText = strings.TrimSuffix(cleanText, "```")
		cleanText = strings.TrimSpace(cleanText)

		if jsonErr := json.Unmarshal([]byte(cleanText), &result); jsonErr == nil {
			parsed = true
		} else if match := jsonObjectRe.FindString(resp.Text); match != "" {
			if jsonErr := json.Unmarshal([]byte(match), &result); jsonErr == nil {
				parsed = true
			}
		}
	}

	// 3. Fallback Heuristic if AI was offline or parsing failed
	if !parsed || result.Summary == "" {
		result = generateFallbackDiagnosis(projectPath, command, failureLogs, hasNodeModules)
	}

	if result.StartCommand == "" {
		if projectPath != "" {
			result.StartCommand = DetectStartCommand(projectPath)
		}
		if result.StartCommand == "" {
			if strings.Contains(command, "docker") {
				result.StartCommand = "docker build & deploy"
			} else {
				result.StartCommand = "npm run dev"
			}
		}
	}

	return &result, nil
}

func generateFallbackDiagnosis(projectPath, command, logs string, hasNodeModules bool) DiagnosisResult {
	lowerLogs := strings.ToLower(logs)

	// 1. Docker daemon & Named-Pipe Connectivity Errors (Windows / Linux / macOS)
	if strings.Contains(lowerLogs, "pipe/docker_engine") ||
		strings.Contains(lowerLogs, "dockerdesktoplinuxengine") ||
		strings.Contains(lowerLogs, "cannot connect to the docker daemon") ||
		strings.Contains(lowerLogs, "is the docker daemon running") ||
		strings.Contains(lowerLogs, "open //./pipe/docker_engine") ||
		(strings.Contains(lowerLogs, "error during connect") && (strings.Contains(lowerLogs, "docker") || strings.Contains(lowerLogs, "pipe") || strings.Contains(lowerLogs, "daemon"))) {
		return DiagnosisResult{
			Summary:   "Docker Engine Connection Failed: Unable to reach Docker daemon.",
			RootCause: "PutmeIn was unable to connect to the Docker daemon. On Windows, Docker Desktop may not be running, WSL 2 backend may be stopped, or the named pipe (npipe:////./pipe/docker_engine) is unavailable. On Linux/macOS, the Docker socket (/var/run/docker.sock) is unreachable.",
			FixSteps: []string{
				"Start Docker Desktop (or run 'sudo systemctl start docker' on Linux)",
				"On Windows: Verify Docker Desktop settings have WSL 2 enabled and engine running",
				"Ensure your user account belongs to the 'docker-users' (Windows) or 'docker' (Linux) group",
				"Once Docker is running, click 'Retry Diagnosis' or redeploy the project",
			},
			Commands:     []string{},
			StartCommand: "docker info",
			CanAutoFix:   false,
		}
	}

	// 2. Dockerfile Build & Syntax Errors
	if strings.Contains(lowerLogs, "dockerfile parse error") ||
		strings.Contains(lowerLogs, "failed to solve with frontend dockerfile") ||
		(strings.Contains(lowerLogs, "docker build") && strings.Contains(lowerLogs, "error:")) {
		return DiagnosisResult{
			Summary:   "Docker Build Failed: Error occurred while building container image.",
			RootCause: "The container image build encountered a syntax error or a failing command step in the Dockerfile.",
			FixSteps: []string{
				"Inspect the Dockerfile instructions and verify syntax",
				"Verify all files referenced in COPY/ADD commands exist in the repository",
				"Test building the image locally using 'docker build .'",
			},
			Commands:     []string{},
			StartCommand: "docker build .",
			CanAutoFix:   false,
		}
	}

	// 3. Port Conflicts
	if strings.Contains(lowerLogs, "eaddrinuse") || strings.Contains(lowerLogs, "port already in use") || strings.Contains(lowerLogs, "address already in use") {
		startCmd := ""
		if projectPath != "" {
			startCmd = DetectStartCommand(projectPath)
		}
		if startCmd == "" {
			startCmd = "npm run dev"
		}
		return DiagnosisResult{
			Summary:      "Port Conflict: Another process is already running on the configured port.",
			RootCause:    "The target port is currently bound by another active process.",
			FixSteps:     []string{"Kill conflicting processes or start on an alternate port", "Start development server"},
			Commands:     []string{},
			StartCommand: startCmd,
			CanAutoFix:   false,
		}
	}

	// 4. Missing Dependencies (only for local projects that actually have a project directory and aren't pure container deployments)
	isContainerCommand := strings.Contains(command, "docker")
	if !isContainerCommand && projectPath != "" && (!hasNodeModules || strings.Contains(lowerLogs, "command not found") || strings.Contains(lowerLogs, "code 127") || strings.Contains(lowerLogs, "cannot find module")) {
		// Check package manager
		installCmd := "npm install"
		if _, err := os.Stat(filepath.Join(projectPath, "pnpm-lock.yaml")); err == nil {
			installCmd = "pnpm install"
		} else if _, err := os.Stat(filepath.Join(projectPath, "yarn.lock")); err == nil {
			installCmd = "yarn install"
		} else if _, err := os.Stat(filepath.Join(projectPath, "bun.lockb")); err == nil {
			installCmd = "bun install"
		}

		return DiagnosisResult{
			Summary:   "Missing dependencies: the required packages are not installed in the workspace.",
			RootCause: fmt.Sprintf("The executable '%s' or required modules were not found because 'node_modules' is missing in '%s'.", filepath.Base(command), projectPath),
			FixSteps: []string{
				fmt.Sprintf("Run '%s' in the project directory to install dependencies", installCmd),
				"Start the development server",
			},
			Commands:     []string{installCmd},
			StartCommand: DetectStartCommand(projectPath),
			CanAutoFix:   true,
		}
	}

	// Default fallback
	startCmd := ""
	if projectPath != "" {
		startCmd = DetectStartCommand(projectPath)
	}
	if startCmd == "" {
		if isContainerCommand {
			startCmd = "docker build & deploy"
		} else {
			startCmd = "npm run dev"
		}
	}

	return DiagnosisResult{
		Summary:      "Startup script failed with error.",
		RootCause:    "The project process exited unexpectedly with an error status.",
		FixSteps:     []string{"Inspect project configuration and dependencies", "Retry running the project"},
		Commands:     []string{"npm install"},
		StartCommand: startCmd,
		CanAutoFix:   !isContainerCommand,
	}
}

// ExecuteFix executes the fix commands sequentially and restarts the project process.
func ExecuteFix(ctx context.Context, projectID, projectPath string, commands []string, startCommand string) (*FixResult, error) {
	if projectPath == "" {
		return nil, fmt.Errorf("projectPath is required")
	}

	var outputBuf bytes.Buffer

	// 1. Run all fix commands
	for i, cmdStr := range commands {
		cmdStr = strings.TrimSpace(cmdStr)
		if cmdStr == "" {
			continue
		}

		outputBuf.WriteString(fmt.Sprintf("\n--- [%d/%d] Executing: %s ---\n", i+1, len(commands), cmdStr))

		var cmd *exec.Cmd
		if runtime.GOOS == "windows" {
			cmd = exec.CommandContext(ctx, "cmd", "/C", cmdStr)
		} else {
			cmd = exec.CommandContext(ctx, "sh", "-c", cmdStr)
		}
		cmd.Dir = projectPath
		cmd.Env = append(os.Environ(), "FORCE_COLOR=1", "PYTHONUNBUFFERED=1")

		out, err := cmd.CombinedOutput()
		outputBuf.Write(out)

		if err != nil {
			outputBuf.WriteString(fmt.Sprintf("\n❌ Command failed: %v\n", err))
			return &FixResult{
				Success: false,
				Logs:    outputBuf.String(),
				Error:   fmt.Sprintf("command '%s' failed: %v", cmdStr, err),
			}, nil
		}
		outputBuf.WriteString("\n✓ Completed successfully.\n")
	}

	// 2. Determine start command
	if startCommand == "" {
		startCommand = DetectStartCommand(projectPath)
		if startCommand == "" {
			startCommand = "npm run dev"
		}
	}

	// 3. Spawn managed process if projectID is provided
	var mp *ManagedProcess
	if projectID != "" {
		outputBuf.WriteString(fmt.Sprintf("\n--- Starting project: %s ---\n", startCommand))
		spawned, err := SpawnManagedProcess(ctx, projectID, projectPath, startCommand, 0)
		if err != nil {
			outputBuf.WriteString(fmt.Sprintf("\n❌ Failed to start project: %v\n", err))
			return &FixResult{
				Success:      false,
				Logs:         outputBuf.String(),
				Error:        fmt.Sprintf("failed to spawn: %v", err),
				StartCommand: startCommand,
			}, nil
		}
		mp = spawned
		outputBuf.WriteString(fmt.Sprintf("✓ Process started with PID %d (logging to %s)\n", mp.PID, mp.LogFile))
	}

	return &FixResult{
		Success:      true,
		Logs:         outputBuf.String(),
		Spawned:      mp,
		StartCommand: startCommand,
	}, nil
}

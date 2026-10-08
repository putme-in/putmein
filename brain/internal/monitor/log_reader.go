package monitor

import (
	"brain/server/internal/hostlogs"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// TailFile reads new bytes from path starting at offset.
// Returns the new content and the updated offset.
func TailFile(path string, offset int64) (content string, newOffset int64, err error) {
	if hostlogs.IsManaged(path) {
		return hostlogs.ReadSince(path, offset, 64*1024)
	}
	if strings.HasPrefix(path, "docker:") {
		containerName := strings.TrimPrefix(path, "docker:")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		args := []string{"logs", "--timestamps", "--tail", "1000"}
		if offset > 0 {
			args = append(args, "--since", time.Unix(0, offset).UTC().Format(time.RFC3339Nano))
		}
		boundary := time.Now().UnixNano()
		args = append(args, "--until", time.Unix(0, boundary).UTC().Format(time.RFC3339Nano), containerName)
		out, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
		if err != nil {
			return "", offset, err
		}
		return string(out), boundary, nil
	}

	f, err := os.Open(path)
	if err != nil {
		return "", offset, err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return "", offset, err
	}
	if info.Size() < offset {
		offset = 0
	}
	if info.Size() == offset {
		return "", offset, nil
	}
	if _, err = f.Seek(offset, 0); err != nil {
		return "", offset, err
	}
	const maxRead = 64 * 1024
	buf := make([]byte, maxRead)
	n, _ := f.Read(buf)
	return string(buf[:n]), offset + int64(n), nil
}

// ReadFileTail reads up to the last `lines` lines from the given file path.
// It seeks near the end of the file (up to 2MB) for performance on large log files.
func ReadFileTail(path string, lines int) (string, error) {
	if hostlogs.IsManaged(path) {
		return hostlogs.ReadTail(path, lines)
	}
	if lines <= 0 {
		lines = 100
	}
	if strings.HasPrefix(path, "docker:") {
		containerName := strings.TrimPrefix(path, "docker:")
		out, err := RunLogCommand(context.Background(), fmt.Sprintf("docker logs --tail %d %s 2>&1", lines, shellEscape(containerName)))
		if err != nil {
			return "", err
		}
		return out, nil
	}

	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return "", err
	}

	size := info.Size()
	if size == 0 {
		return "", nil
	}

	// Read up to 2MB from the end
	maxBytes := int64(2 * 1024 * 1024)
	offset := int64(0)
	if size > maxBytes {
		offset = size - maxBytes
	}

	if _, err = f.Seek(offset, 0); err != nil {
		return "", err
	}

	data, err := io.ReadAll(f)
	if err != nil {
		return "", err
	}

	raw := string(data)
	allLines := strings.Split(strings.TrimRight(raw, "\n"), "\n")
	if len(allLines) <= lines {
		return strings.Join(allLines, "\n"), nil
	}
	return strings.Join(allLines[len(allLines)-lines:], "\n"), nil
}

// NormalizeCommandForOS adjusts shell commands for cross-platform execution (e.g. Windows cmd vs Unix sh).
func NormalizeCommandForOS(cmd string, targetOS string) string {
	if targetOS == "windows" {
		// On Windows cmd.exe, Unix redirection to /dev/null causes "The system cannot find the path specified."
		// Translate /dev/null redirection to the Windows NUL device.
		normalized := strings.ReplaceAll(cmd, "2>/dev/null", "2>nul")
		normalized = strings.ReplaceAll(normalized, ">/dev/null", ">nul")
		normalized = strings.ReplaceAll(normalized, "> /dev/null", "> nul")
		return normalized
	}
	return cmd
}

// RunLogCommand runs a shell command and returns its output.
func RunLogCommand(ctx context.Context, cmd string) (string, error) {
	var c *exec.Cmd
	if runtime.GOOS == "windows" {
		c = exec.CommandContext(ctx, "cmd", "/C", NormalizeCommandForOS(cmd, "windows"))
	} else {
		c = exec.CommandContext(ctx, "sh", "-c", cmd)
	}
	out, err := c.CombinedOutput()
	return string(out), err
}

// DiscoverLogSources discovers project-specific log sources.
// OS-level system logs are intentionally NOT included — they produce noise
// unrelated to the project. Only project-specific sources are returned.
func DiscoverLogSources(ctx context.Context, projectPath string) (logPaths []string, logCmd string, err error) {
	found := make(map[string]bool)

	// 1. Find explicit log files in the project directory
	logExts := []string{".log", ".out", ".err"}
	_ = filepath.WalkDir(projectPath, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		if d.IsDir() && (name == "node_modules" || name == ".git" || name == "vendor" ||
			name == ".next" || name == "dist" || name == "__pycache__" || name == ".cache" ||
			name == "coverage" || name == ".turbo") {
			return filepath.SkipDir
		}
		if !d.IsDir() {
			for _, ext := range logExts {
				if strings.HasSuffix(strings.ToLower(name), ext) {
					found[path] = true
					return nil
				}
			}
		}
		return nil
	})

	// 2. Common log directories relative to project path
	for _, rel := range []string{"logs", "log", ".pm2/logs", "storage/logs", "var/log"} {
		dir := filepath.Join(projectPath, rel)
		if entries, e := os.ReadDir(dir); e == nil {
			for _, e := range entries {
				if !e.IsDir() {
					p := filepath.Join(dir, e.Name())
					ext := strings.ToLower(filepath.Ext(e.Name()))
					for _, logExt := range logExts {
						if ext == logExt {
							found[p] = true
						}
					}
				}
			}
		}
	}

	// 3. Detect project type and build the best log command
	projectType := detectProjectType(projectPath)
	logCmd = buildLogCommand(ctx, projectPath, projectType)

	// 4. Find open log files of the running process (if any)
	for _, p := range detectRunningProcessLogs(ctx, projectPath) {
		found[p] = true
	}

	for path := range found {
		logPaths = append(logPaths, path)
	}
	return logPaths, logCmd, nil
}

// detectRunningProcessLogs finds PIDs of processes running from the project path
// and returns any log files those processes have open.
func detectRunningProcessLogs(ctx context.Context, projectPath string) []string {
	// Find PIDs whose cwd matches the project path via lsof
	cwdCmd := fmt.Sprintf(
		`lsof -w +D %s 2>/dev/null | awk 'NR>1 {print $2}' | sort -u | head -20`,
		shellEscape(projectPath),
	)
	pidsOut, _ := RunLogCommand(ctx, cwdCmd)

	seen := make(map[string]bool)
	var pids []string
	for _, line := range strings.Split(strings.TrimSpace(pidsOut), "\n") {
		pid := strings.TrimSpace(line)
		if pid != "" && pid != "PID" && !seen[pid] {
			seen[pid] = true
			pids = append(pids, pid)
		}
	}

	// Also pgrep by project path
	pidCmd := fmt.Sprintf(`pgrep -f %s 2>/dev/null | head -5`, shellEscape(projectPath))
	if out, _ := RunLogCommand(ctx, pidCmd); out != "" {
		for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
			pid := strings.TrimSpace(line)
			if pid != "" && !seen[pid] {
				seen[pid] = true
				pids = append(pids, pid)
			}
		}
	}

	if len(pids) == 0 {
		return nil
	}

	var logFiles []string
	seenFiles := make(map[string]bool)
	for _, pid := range pids {
		lsofCmd := fmt.Sprintf(
			`lsof -p %s -w 2>/dev/null | awk '$5=="REG" || $5=="VREG" {print $9}' | grep -E '\.(log|out|err)$' | head -10`,
			pid,
		)
		out, err := RunLogCommand(ctx, lsofCmd)
		if err != nil {
			continue
		}
		for _, f := range strings.Split(strings.TrimSpace(out), "\n") {
			f = strings.TrimSpace(f)
			if f == "" || seenFiles[f] {
				continue
			}
			seenFiles[f] = true
			if info, err := os.Stat(f); err == nil && !info.IsDir() {
				logFiles = append(logFiles, f)
			}
		}
	}
	return logFiles
}

func shellEscape(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// detectProjectType guesses the project type from its contents.
func detectProjectType(projectPath string) string {
	checks := []struct{ file, kind string }{
		{"next.config.js", "nextjs"},
		{"next.config.ts", "nextjs"},
		{"next.config.mjs", "nextjs"},
		{"package.json", "nodejs"},
		{"requirements.txt", "python"},
		{"Pipfile", "python"},
		{"pyproject.toml", "python"},
		{"Gemfile", "ruby"},
		{"go.mod", "go"},
		{"Cargo.toml", "rust"},
		{"composer.json", "php"},
		{"pom.xml", "java"},
		{"build.gradle", "java"},
	}
	for _, c := range checks {
		if _, err := os.Stat(filepath.Join(projectPath, c.file)); err == nil {
			return c.kind
		}
	}
	return "generic"
}

// buildLogCommand returns the best shell command to capture live logs for a project.
// Priority: PM2 > systemd. File logs are returned separately by discovery.
func buildLogCommand(ctx context.Context, projectPath string, projectType string) string {
	baseName := filepath.Base(projectPath)

	// PM2 check
	if out, err := RunLogCommand(ctx, "pm2 list --no-color 2>/dev/null"); err == nil && strings.Contains(out, baseName) {
		return fmt.Sprintf("pm2 logs %s --lines 150 --nostream 2>&1 || true", shellEscape(baseName))
	}

	// systemd check
	if out, err := RunLogCommand(ctx, fmt.Sprintf("systemctl is-active %s 2>/dev/null", shellEscape(baseName))); err == nil && strings.TrimSpace(out) == "active" {
		return fmt.Sprintf("journalctl -u %s -n 150 --no-pager 2>&1 || true", shellEscape(baseName))
	}

	// Discovery already returns real log files. Process listings and framework
	// traces are not application stdout and must never be displayed as logs.
	return ""
}

// SystemLogCommand returns a shell command to get recent OS system health logs.
// This is kept for on-demand use only — it is NOT run automatically every poll cycle
// to avoid flooding the project with unrelated system-level alerts.
func SystemLogCommand() string {
	switch runtime.GOOS {
	case "darwin":
		return "log show --predicate 'eventMessage contains \"error\" or eventMessage contains \"fail\" or eventMessage contains \"critical\"' --last 5m --style compact 2>&1 | head -100 || tail -50 /var/log/system.log 2>&1 || true"
	case "linux":
		return "journalctl -n 100 --no-pager -p err..emerg 2>&1 || tail -50 /var/log/syslog 2>&1 || true"
	default:
		return ""
	}
}

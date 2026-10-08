package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"brain/server/internal/agent"
	"brain/server/internal/ai"
	"brain/server/internal/deploy"
	"brain/server/internal/monitor"
)

type monitorProjectDTO struct {
	ID             string      `json:"id"`
	Name           string      `json:"name"`
	ProjectPath    string      `json:"projectPath"`
	LogPaths       interface{} `json:"logPaths"` // string (JSON) or []string
	LogCommand     string      `json:"logCommand"`
	RunCommand     string      `json:"runCommand"`
	IntervalSec    int         `json:"intervalSec"`
	Status         string      `json:"status"`
	Memory         string      `json:"memory"`
	MemoryStatus   string      `json:"memoryStatus"`
	ProjectUrl     string      `json:"projectUrl"`
	ManagedPid     int         `json:"managedPid"`
	ManagedLogFile string      `json:"managedLogFile"`
	Alerts         []struct {
		Severity  string `json:"severity"`
		Message   string `json:"message"`
		CreatedAt string `json:"createdAt"`
	} `json:"alerts"`
}

// chatRequest is the body for POST /v1/chat and POST /v1/chat/tui
type chatRequest struct {
	Messages []struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"messages"`
	ModelID         string              `json:"modelId"`
	Mode            string              `json:"mode"` // "tui" or "web"
	Autonomous      bool                `json:"autonomous"`
	UserID          string              `json:"userId"` // forwarded by Ray for DB persistence
	MonitorProjects []monitorProjectDTO `json:"monitorProjects,omitempty"`
	GitHubToken     string              `json:"githubToken,omitempty"`
	GitHubUsername  string              `json:"githubUsername,omitempty"`
	ExecutionMode   string              `json:"executionMode,omitempty"`
}

// ── Tool tag regexes (same as agent package) ─────────────────────────────────

var (
	chatExecRe   = regexp.MustCompile(`(?s)<exec>(.*?)</exec>`)
	chatReadRe   = regexp.MustCompile(`(?s)<read_file>(.*?)</read_file>`)
	chatWriteRe  = regexp.MustCompile(`(?s)<write_file path="([^"]+)">(.*?)</write_file>`)
	chatListRe   = regexp.MustCompile(`(?s)<list_dir>(.*?)</list_dir>`)
	chatMkdirRe  = regexp.MustCompile(`(?s)<create_dir>(.*?)</create_dir>`)
	chatDeleteRe = regexp.MustCompile(`(?s)<delete_file>(.*?)</delete_file>`)
	// monitor_add: matches self-closing or open tag, with or without interval, flexible whitespace
	chatMonitorAddRe = regexp.MustCompile(`<monitor_add[^>]*name="([^"]+)"[^>]*path="([^"]+)"[^>]*>`)
	// deploy: matches <deploy ...> with name and path attributes in any order
	chatDeployTagRe   = regexp.MustCompile(`<deploy\s+([^>]+)>?`)
	chatNameAttrRe    = regexp.MustCompile(`name="([^"]+)"`)
	chatPathAttrRe    = regexp.MustCompile(`path="([^"]+)"`)
	chatPortAttrRe    = regexp.MustCompile(`port="?(\d+)"?`)
	chatCheckPortsRe  = regexp.MustCompile(`(?s)<check_ports\s*/?>`)
	chatSetDomainsRe  = regexp.MustCompile(`<set_domains\s+([^>]+)>?`)
	chatProjectAttrRe = regexp.MustCompile(`project="([^"]+)"`)
	chatDomainsAttrRe = regexp.MustCompile(`domains="([^"]+)"`)
	chatPlanTagRe     = regexp.MustCompile(`(?s)<plan(?:\s+title="([^"]+)")?\s*>(.*?)</plan>`)
)

// detectTool parses text for any tool tag and returns (toolName, cmdOrPath, found)
// WITHOUT executing anything. Safe to call before asking for permission.
func detectTool(text string) (toolName, arg string, found bool) {
	if chatCheckPortsRe.MatchString(text) {
		return "check_ports", "", true
	}
	if m := chatSetDomainsRe.FindStringSubmatch(text); len(m) > 1 {
		attrs := m[1]
		var project, domains string
		if pm := chatProjectAttrRe.FindStringSubmatch(attrs); len(pm) > 1 {
			project = strings.TrimSpace(pm[1])
		}
		if dm := chatDomainsAttrRe.FindStringSubmatch(attrs); len(dm) > 1 {
			domains = strings.TrimSpace(dm[1])
		}
		if project != "" && domains != "" {
			return "set_domains", project + "|" + domains, true
		}
	}
	if m := chatExecRe.FindStringSubmatch(text); len(m) > 1 {
		return "exec", strings.TrimSpace(m[1]), true
	}
	if m := chatDeployTagRe.FindStringSubmatch(text); len(m) > 1 {
		attrs := m[1]
		var name, path, port string
		if nm := chatNameAttrRe.FindStringSubmatch(attrs); len(nm) > 1 {
			name = strings.TrimSpace(nm[1])
		}
		if pm := chatPathAttrRe.FindStringSubmatch(attrs); len(pm) > 1 {
			path = strings.TrimSpace(pm[1])
		}
		if ptm := chatPortAttrRe.FindStringSubmatch(attrs); len(ptm) > 1 {
			port = strings.TrimSpace(ptm[1])
		}
		if port == "" {
			port = "0"
		}
		if name != "" && path != "" {
			return "deploy", name + "|" + path + "|" + port, true
		}
	}
	if m := chatMonitorAddRe.FindStringSubmatch(text); len(m) > 2 {
		// Return the project path as the arg, name is embedded
		return "monitor_add", strings.TrimSpace(m[1]) + "|" + strings.TrimSpace(m[2]), true
	}
	if m := chatListRe.FindStringSubmatch(text); len(m) > 1 {
		return "list_dir", strings.TrimSpace(m[1]), true
	}
	if m := chatReadRe.FindStringSubmatch(text); len(m) > 1 {
		return "read_file", strings.TrimSpace(m[1]), true
	}
	if m := chatWriteRe.FindStringSubmatch(text); len(m) > 2 {
		return "write_file", strings.TrimSpace(m[1]), true
	}
	if m := chatMkdirRe.FindStringSubmatch(text); len(m) > 1 {
		return "create_dir", strings.TrimSpace(m[1]), true
	}
	if m := chatDeleteRe.FindStringSubmatch(text); len(m) > 1 {
		return "delete_file", strings.TrimSpace(m[1]), true
	}
	return "", "", false
}

// hasIncompleteIntent checks if the AI's response has an unclosed XML tool tag
// (e.g. started <exec> or <deploy but was truncated before the closing tag).
func hasIncompleteIntent(text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return false
	}
	// Check for unclosed tool tags only
	if strings.Contains(trimmed, "<exec>") && !strings.Contains(trimmed, "</exec>") {
		return true
	}
	if strings.Contains(trimmed, "<read_file>") && !strings.Contains(trimmed, "</read_file>") {
		return true
	}
	if strings.Contains(trimmed, "<write_file") && !strings.Contains(trimmed, "</write_file>") {
		return true
	}
	if strings.Contains(trimmed, "<list_dir>") && !strings.Contains(trimmed, "</list_dir>") {
		return true
	}
	if strings.Contains(trimmed, "<create_dir>") && !strings.Contains(trimmed, "</create_dir>") {
		return true
	}
	if strings.Contains(trimmed, "<delete_file>") && !strings.Contains(trimmed, "</delete_file>") {
		return true
	}
	if strings.Contains(trimmed, "<deploy") && !strings.Contains(trimmed, ">") {
		return true
	}
	if strings.Contains(trimmed, "<set_domains") && !strings.Contains(trimmed, ">") {
		return true
	}
	if strings.Contains(trimmed, "<monitor_add") && !strings.Contains(trimmed, ">") {
		return true
	}
	return false
}

// runDetectedTool executes the tool after permission has been granted.
func runDetectedTool(ctx context.Context, text, toolName, arg, userID, githubToken string, onProgress func(string)) (output string) {
	switch toolName {
	case "exec":
		cmdToRun := arg

		out, err := agent.ExecuteWithStream(ctx, cmdToRun, onProgress)
		if err != nil {
			return fmt.Sprintf("Error running command: %v\n%s", err, out)
		}
		return out
	case "list_dir":
		out, err := agent.ExecuteWithStream(ctx, "ls -la "+shellQuote(arg), onProgress)
		if err != nil {
			listing, err2 := agent.ListDir(arg)
			if err2 != nil {
				return fmt.Sprintf("Error: %v", err2)
			}
			if onProgress != nil {
				onProgress(listing)
			}
			return listing
		}
		return out
	case "read_file":
		content, err := agent.ReadFile(arg)
		if err != nil {
			return fmt.Sprintf("Error: %v", err)
		}
		if onProgress != nil {
			preview := content
			if len(preview) > 2000 {
				preview = preview[:2000] + fmt.Sprintf("\n... [%d more bytes]", len(content)-2000)
			}
			onProgress(preview)
		}
		return content
	case "write_file":
		if m := chatWriteRe.FindStringSubmatch(text); len(m) > 2 {
			if err := agent.WriteFile(arg, m[2]); err != nil {
				return fmt.Sprintf("Error: %v", err)
			}
			res := fmt.Sprintf("File written: %s (%d bytes)", arg, len(m[2]))
			if onProgress != nil {
				onProgress(res)
			}
			return res
		}
		return "Error: could not parse write_file tag"
	case "create_dir":
		if err := agent.CreateDir(arg); err != nil {
			return fmt.Sprintf("Error: %v", err)
		}
		res := fmt.Sprintf("Directory created: %s", arg)
		if onProgress != nil {
			onProgress(res)
		}
		return res
	case "delete_file":
		if err := agent.DeleteFile(arg); err != nil {
			return fmt.Sprintf("Error: %v", err)
		}
		res := fmt.Sprintf("Deleted: %s", arg)
		if onProgress != nil {
			onProgress(res)
		}
		return res
	case "deploy":
		parts := strings.SplitN(arg, "|", 3)
		source := ""
		if len(parts) > 1 {
			source = parts[1]
		}
		if strings.HasPrefix(source, "https://") {
			parsed, err := url.Parse(source)
			if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
				source = ""
			}
		} else if !filepath.IsAbs(source) {
			source = ""
		}
		proposal := map[string]any{"name": parts[0], "source": source}
		settings := map[string]any{}
		if len(parts) > 2 && parts[2] != "0" {
			if port, err := strconv.Atoi(parts[2]); err == nil && port > 0 && port <= 65535 {
				settings["hostPort"] = port
			}
		}
		if match := regexp.MustCompile(`(?s)<deployment_settings>(.*?)</deployment_settings>`).FindStringSubmatch(text); len(match) > 1 {
			var supplied map[string]any
			if len(match[1]) > 16384 || json.Unmarshal([]byte(match[1]), &supplied) != nil {
				return "Error: deployment settings must be a valid JSON object."
			}
			for _, key := range []string{"branch", "appDirectory", "framework", "buildCommand", "startCommand", "hostPort", "containerPort", "projectUrl", "dockerEnabled", "routingMode", "healthCheck"} {
				if value, ok := supplied[key]; ok {
					settings[key] = value
				}
			}
		}
		if len(settings) > 0 {
			proposal["setup"] = settings
		}
		data, _ := json.Marshal(proposal)
		result := "RAY_DEPLOYMENT_SETUP:" + string(data)
		if onProgress != nil {
			onProgress(result)
		}
		return result
	case "check_ports":
		claimed, _ := deploy.GetUsedPortsMap()
		nextFree, _ := deploy.FindGuaranteedFreePort(0, "")
		var ports []int
		for p := range claimed {
			ports = append(ports, p)
		}
		sort.Ints(ports)
		var sb strings.Builder
		sb.WriteString("REAL-TIME DASHBOARD & SYSTEM PORT ALLOCATION REGISTRY:\n")
		for _, p := range ports {
			sb.WriteString(fmt.Sprintf("- Port :%d: %s\n", p, claimed[p]))
		}
		sb.WriteString(fmt.Sprintf("\nNEXT GUARANTEED FREE HOST PORT FOR DEPLOYMENT: :%d\n", nextFree))
		res := sb.String()
		if onProgress != nil {
			onProgress(res)
		}
		return res
	case "set_domains":
		// arg is "project|domains"
		parts := strings.SplitN(arg, "|", 2)
		projectNameOrID := parts[0]
		domains := ""
		if len(parts) > 1 {
			domains = parts[1]
		}
		rayURL := os.Getenv("RAY_URL")
		if rayURL == "" {
			rayURL = "http://localhost:3000"
		}
		secret := os.Getenv("BRAIN_INTERNAL_SECRET")
		if secret == "" {
			return "Error: BRAIN_INTERNAL_SECRET is not configured in environment"
		}
		payload, _ := json.Marshal(map[string]any{
			"id":         projectNameOrID,
			"name":       projectNameOrID,
			"projectUrl": domains,
		})
		httpReq, err := http.NewRequestWithContext(ctx, "PATCH", rayURL+"/api/monitor/internal/update-project", bytes.NewReader(payload))
		if err != nil {
			return fmt.Sprintf("Error creating request to update domains: %v", err)
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("x-brain-secret", secret)
		client := &http.Client{Timeout: 8 * time.Second}
		resp, err := client.Do(httpReq)
		if err != nil {
			return fmt.Sprintf("Error connecting to dashboard API to set domains: %v", err)
		}
		defer resp.Body.Close()
		bodyBytes, _ := io.ReadAll(resp.Body)
		if resp.StatusCode >= 400 {
			var errResp struct {
				Error string `json:"error"`
			}
			_ = json.Unmarshal(bodyBytes, &errResp)
			if errResp.Error != "" {
				return fmt.Sprintf("Failed to update domains: %s", errResp.Error)
			}
			return fmt.Sprintf("Failed to update domains (status %d): %s", resp.StatusCode, string(bodyBytes))
		}
		res := fmt.Sprintf("Successfully assigned domains [%s] to project %q. These references do not provision DNS or certificates. Configure managed HTTPS in project deployment setup.", domains, projectNameOrID)
		if onProgress != nil {
			onProgress(res)
		}
		return res
	case "monitor_add":
		// arg is "name|path"
		parts := strings.SplitN(arg, "|", 2)
		name := parts[0]
		path := ""
		if len(parts) > 1 {
			path = parts[1]
		}
		if err := monitor.AddProjectFromChat(userID, name, path, 30); err != nil {
			errStr := fmt.Sprintf("Error adding to monitor: %v", err)
			if onProgress != nil {
				onProgress(errStr + "\n")
			}
			return errStr
		}
		res := fmt.Sprintf("Project %q is now being monitored at %s", name, path)
		if onProgress != nil {
			onProgress(res + "\n")
		}
		return res
	}
	return "unknown tool"
}

func shellQuote(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"`
}

// injectMonitorContext appends monitored project context (metadata, live logs, memory, running terminal)
// to the user message so the AI can answer accurately and troubleshoot effectively.
func injectMonitorContext(ctx context.Context, userInput string, reqProjects []monitorProjectDTO) string {
	type unifiedProj struct {
		ID             string
		Name           string
		ProjectPath    string
		LogPaths       []string
		LogCommand     string
		RunCommand     string
		Status         string
		Memory         string
		ProjectUrl     string
		ManagedPid     int
		ManagedLogFile string
		Alerts         []string
	}

	projectsMap := make(map[string]*unifiedProj)

	// 1. In-memory projects from monitor.Global
	if monitor.Global != nil {
		for _, p := range monitor.Global.ListProjects() {
			projectsMap[p.ID] = &unifiedProj{
				ID:             p.ID,
				Name:           p.Name,
				ProjectPath:    p.ProjectPath,
				LogPaths:       p.LogPaths,
				LogCommand:     p.LogCommand,
				RunCommand:     p.RunCommand,
				Status:         string(p.Status),
				Memory:         p.Memory,
				ProjectUrl:     p.ProjectUrl,
				ManagedPid:     p.ManagedPid,
				ManagedLogFile: p.ManagedLogFile,
			}
		}
	}

	// 2. Overlay projects passed from Ray Next.js request
	for _, rp := range reqProjects {
		var lpaths []string
		switch v := rp.LogPaths.(type) {
		case []string:
			lpaths = v
		case []interface{}:
			for _, item := range v {
				if s, ok := item.(string); ok {
					lpaths = append(lpaths, s)
				}
			}
		case string:
			_ = json.Unmarshal([]byte(v), &lpaths)
		}

		var alertStrs []string
		for _, a := range rp.Alerts {
			alertStrs = append(alertStrs, fmt.Sprintf("[%s] %s", strings.ToUpper(a.Severity), a.Message))
		}

		if existing, ok := projectsMap[rp.ID]; ok {
			if rp.Memory != "" {
				existing.Memory = rp.Memory
			}
			if rp.Status != "" {
				existing.Status = rp.Status
			}
			if rp.ManagedPid != 0 {
				existing.ManagedPid = rp.ManagedPid
			}
			if rp.ManagedLogFile != "" {
				existing.ManagedLogFile = rp.ManagedLogFile
			}
			if rp.ProjectUrl != "" {
				existing.ProjectUrl = rp.ProjectUrl
			}
			if len(lpaths) > 0 {
				existing.LogPaths = lpaths
			}
			existing.Alerts = alertStrs
		} else {
			projectsMap[rp.ID] = &unifiedProj{
				ID:             rp.ID,
				Name:           rp.Name,
				ProjectPath:    rp.ProjectPath,
				LogPaths:       lpaths,
				LogCommand:     rp.LogCommand,
				RunCommand:     rp.RunCommand,
				Status:         rp.Status,
				Memory:         rp.Memory,
				ProjectUrl:     rp.ProjectUrl,
				ManagedPid:     rp.ManagedPid,
				ManagedLogFile: rp.ManagedLogFile,
				Alerts:         alertStrs,
			}
		}
	}

	if len(projectsMap) == 0 {
		return userInput
	}

	lowerInput := strings.ToLower(userInput)
	hasExplicitTarget := strings.Contains(lowerInput, "[target container:") ||
		strings.Contains(lowerInput, "[attached docker container]") ||
		strings.Contains(lowerInput, "[target github repo") ||
		strings.Contains(lowerInput, "[attached github repository]") ||
		strings.Contains(lowerInput, "[target project:")

	var sb strings.Builder
	sb.WriteString(userInput)

	// If a Docker container context or mention is present (or any follow-up questions like "fixed", "status", "issue"), fetch live container state
	if strings.Contains(lowerInput, "container") || strings.Contains(lowerInput, "docker") || strings.Contains(lowerInput, "target container") ||
		strings.Contains(lowerInput, "fixed") || strings.Contains(lowerInput, "issue") || strings.Contains(lowerInput, "work") {
		if cOut, err := monitor.RunLogCommand(ctx, `docker ps -a --format "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"`); err == nil && strings.TrimSpace(cOut) != "" {
			sb.WriteString("\n\n[DOCKER CONTAINERS RUNTIME STATE]\n")
			for _, cLine := range strings.Split(strings.TrimSpace(cOut), "\n") {
				cParts := strings.Split(cLine, "\t")
				if len(cParts) >= 2 {
					cName := cParts[1]
					image := ""
					if len(cParts) > 2 {
						image = cParts[2]
					}
					status := ""
					if len(cParts) > 3 {
						status = cParts[3]
					}
					ports := ""
					if len(cParts) > 4 {
						ports = cParts[4]
					}
					portInfo := ports
					if ports != "" {
						if strings.Contains(ports, "->") {
							portRe := regexp.MustCompile(`(?::|0\.0\.0\.0:)(\d+)->`)
							if m := portRe.FindStringSubmatch(ports); len(m) > 1 {
								portInfo = fmt.Sprintf("Exposed on host port %s (Live URL: http://localhost:%s)", m[1], m[1])
							}
						} else {
							portInfo = fmt.Sprintf("UNEXPOSED (Internal %s only. NOT accessible on host browser! Must recreate with `-p <host_port>:<container_port>` like -p 3001:3000 or -p 4000:3000 to be reachable)", ports)
						}
					} else {
						portInfo = "NO PORTS EXPOSED (Internal only)"
					}
					sb.WriteString(fmt.Sprintf("- Container: %s | Image: %s | Status: %s | Port: %s\n", cName, image, status, portInfo))
					// If specifically mentioned or targeted in context or restarting, tail logs
					if strings.Contains(lowerInput, strings.ToLower(cName)) || strings.Contains(strings.ToLower(status), "restarting") || strings.Contains(strings.ToLower(status), "exited") {
						if cLogs, err := monitor.RunLogCommand(ctx, fmt.Sprintf("docker logs --tail 40 %s 2>&1", shellQuote(cName))); err == nil && strings.TrimSpace(cLogs) != "" {
							sb.WriteString(fmt.Sprintf("  [Recent Docker Logs for %s]:\n%s\n", cName, cLogs))
						}
					}
				}
			}
		}
	}

	// Only inject general monitored projects if no explicit container/github target was attached
	if !hasExplicitTarget {
		var relevantProjects []string
		for _, p := range projectsMap {
			// Skip internal ray dashboard from general injection unless specifically named
			if strings.ToLower(p.Name) == "ray" && !strings.Contains(lowerInput, "@ray") && !strings.Contains(lowerInput, "ray dashboard") {
				continue
			}

			isMentioned := strings.Contains(lowerInput, "@"+strings.ToLower(p.Name)) ||
				(len(p.Name) > 2 && strings.Contains(lowerInput, strings.ToLower(p.Name)))

			if !isMentioned {
				continue
			}

			var pSb strings.Builder
			pSb.WriteString(fmt.Sprintf("\n\nProject: %s (ID: %s)\n", p.Name, p.ID))
			pSb.WriteString(fmt.Sprintf("  Path: %s\n", p.ProjectPath))
			pSb.WriteString(fmt.Sprintf("  Status: %s\n", p.Status))
			if p.RunCommand != "" {
				pSb.WriteString(fmt.Sprintf("  Run Command: %s\n", p.RunCommand))
			}

			if p.ManagedLogFile != "" {
				tail, err := monitor.ReadFileTail(p.ManagedLogFile, 60)
				if err == nil && len(strings.TrimSpace(tail)) > 0 {
					pSb.WriteString(fmt.Sprintf("  [Recent Terminal / Dev Output (%s)]:\n%s\n", filepath.Base(p.ManagedLogFile), tail))
				}
			}
			if p.Memory != "" {
				memPreview := p.Memory
				if len(memPreview) > 1500 {
					memPreview = memPreview[:1500] + "..."
				}
				pSb.WriteString(fmt.Sprintf("  [Project Memory]:\n%s\n", memPreview))
			}
			relevantProjects = append(relevantProjects, pSb.String())
		}

		if len(relevantProjects) > 0 {
			sb.WriteString("\n\n[MONITORED PROJECTS CONTEXT]")
			for _, rp := range relevantProjects {
				sb.WriteString(rp)
			}
		}
	}

	return sb.String()
}

// injectPortRegistryContext appends live dashboard project ports, Docker container ports,
// and guaranteed free ports to the AI prompt context.
// injectPortRegistryContext appends live dashboard project ports, Docker container ports,
// and guaranteed free ports to the AI prompt context.
func injectPortRegistryContext(userInput string, reqProjects []monitorProjectDTO) string {
	claimed, _ := deploy.GetUsedPortsMap()
	if claimed == nil {
		claimed = make(map[int]string)
	}

	// Add ports from request's monitorProjects directly (in-memory, no HTTP call)
	for _, rp := range reqProjects {
		if rp.ProjectUrl != "" {
			portRe := regexp.MustCompile(`:(\d+)`)
			if m := portRe.FindStringSubmatch(rp.ProjectUrl); len(m) > 1 {
				if portNum, err := strconv.Atoi(m[1]); err == nil && portNum > 0 {
					if _, exists := claimed[portNum]; !exists {
						claimed[portNum] = fmt.Sprintf("%s (project)", rp.Name)
					}
				}
			}
		}
	}

	nextFree, _ := deploy.FindGuaranteedFreePortWithClaimed(0, "", claimed)

	var ports []int
	for p := range claimed {
		ports = append(ports, p)
	}
	sort.Ints(ports)

	var sb strings.Builder
	sb.WriteString("\n\n[DASHBOARD & SYSTEM PORT ALLOCATION REGISTRY]\n")
	sb.WriteString("- Currently Occupied Ports on Dashboard & Host:\n")
	for _, p := range ports {
		sb.WriteString(fmt.Sprintf("  * Port :%d — %s\n", p, claimed[p]))
	}

	var suggested []int
	candidate := nextFree
	for len(suggested) < 4 && candidate < 6000 {
		if p, err := deploy.FindGuaranteedFreePortWithClaimed(candidate, "", claimed); err == nil {
			if len(suggested) == 0 || p > suggested[len(suggested)-1] {
				suggested = append(suggested, p)
			}
			candidate = p + 1
		} else {
			break
		}
	}

	var suggestedStrs []string
	for _, p := range suggested {
		suggestedStrs = append(suggestedStrs, fmt.Sprintf(":%d", p))
	}

	sb.WriteString(fmt.Sprintf("- Next Guaranteed Free Host Ports for New Deployments: %s\n", strings.Join(suggestedStrs, ", ")))
	sb.WriteString("- MANDATORY PORT SAFETY RULES:\n")
	sb.WriteString("  * NEVER deploy an application onto an already occupied port (e.g. NEVER reuse :3000, :3100, :4000, :4001).\n")
	sb.WriteString("  * ALWAYS prefer <deploy name=\"name\" path=\"path\"> which automatically checks dashboard projects, active containers, and system sockets to assign a guaranteed conflict-free host port.\n")
	sb.WriteString("  * If running docker manually via <exec>, you MUST only use a port from the Next Guaranteed Free Host Ports list above.\n")

	// Append Routing Mode & Registered Domains context
	mode := agent.GetRoutingMode()
	provider := agent.GetDomainProvider()
	customRoot := agent.GetCustomRootDomain()

	sb.WriteString("\n[DEPLOYMENT ROUTING MODE & REGISTERED DOMAINS]\n")
	sb.WriteString(fmt.Sprintf("- Current Server Routing Mode: %s\n", strings.ToUpper(mode)))
	if mode == "domain" {
		sb.WriteString(fmt.Sprintf("- Domain Provider: %s\n", provider))
		if customRoot != "" {
			sb.WriteString(fmt.Sprintf("- Custom Root Domain: %s\n", customRoot))
		}
	}

	var registeredDomains []string
	for _, rp := range reqProjects {
		if rp.ProjectUrl != "" {
			registeredDomains = append(registeredDomains, fmt.Sprintf("%s -> %s", rp.Name, rp.ProjectUrl))
		}
	}
	if len(registeredDomains) > 0 {
		sb.WriteString("- Currently Registered Domains across Projects:\n")
		for _, rd := range registeredDomains {
			sb.WriteString(fmt.Sprintf("  * %s\n", rd))
		}
	} else {
		sb.WriteString("- Currently Registered Domains: (None yet configured)\n")
	}

	sb.WriteString("- DOMAIN ASSIGNMENT TOOL:\n")
	sb.WriteString("  * You can assign or change domains for any project using: <set_domains project=\"project-name\" domains=\"http://app.sslip.io, https://custom.com\"/>\n")
	sb.WriteString("  * The first domain listed is the primary URL used by the dashboard and \"Open App\" buttons.\n")
	sb.WriteString("  * NEVER reuse an already registered domain for another project; duplicate domains are rejected.\n")
	sb.WriteString("  * When deploying with <deploy name=\"...\" path=\"...\">, the deployment engine uses direct-port access. Configure managed HTTPS and health checks in project deployment setup.\n")

	return userInput + sb.String()
}

// chatStreamHandler handles POST /v1/chat — runs the full agent loop.
// Streams SSE in Vercel AI SDK format (0:, d: lines).
// Used by ray (Next.js web UI).
func chatStreamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req chatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if len(req.Messages) == 0 {
		http.Error(w, "messages required", http.StatusBadRequest)
		return
	}

	modelID := req.ModelID
	if modelID == "" {
		modelID = "MiniMax-M2.5"
	}
	mode := ai.PromptModeWeb
	if req.Mode == "tui" {
		mode = ai.PromptModeTUI
	}

	// Build history
	history := make([]ai.HistoryEntry, 0, len(req.Messages)-1)
	for _, m := range req.Messages[:len(req.Messages)-1] {
		history = append(history, ai.HistoryEntry{Role: m.Role, Content: m.Content})
	}
	lastMsg := req.Messages[len(req.Messages)-1]
	userInput := lastMsg.Content

	// Autonomous: use request flag OR brain's global setting
	autonomous := req.Autonomous || agent.IsAutonomousMode()
	userID := req.UserID

	// Inject monitor context: list all monitored projects + their log paths and real-time state
	userInput = injectMonitorContext(r.Context(), userInput, req.MonitorProjects)

	// Inject live port registry and next available free ports (in-memory, fast)
	userInput = injectPortRegistryContext(userInput, req.MonitorProjects)

	// Inject deployment directory configuration
	deployDir := agent.GetDeploymentsDir()
	userInput += fmt.Sprintf("\n\n[DEPLOYMENT DIRECTORY CONFIGURATION]\n- Active base deployments directory: `%s`\n- When cloning repositories, creating workspaces, or deploying containers, ALWAYS use subfolders inside this base path (e.g. `%s/<project-name>`).\n- Never create deployment project folders in random paths or the workspace root.", deployDir, deployDir)

	userInput += "\nWhen working from an approved plan, return the same <plan title=\"...\"> checklist with completed items marked - [x] and unfinished items - [ ]. Update it after verified tool results and in your final response. Never mark deployment or health complete merely because setup was requested. Never claim the setup card is open without calling <deploy>.\n"
	// Resolve execution mode ("plan" vs "action")
	execMode := strings.ToLower(strings.TrimSpace(req.ExecutionMode))
	if execMode == "" {
		execMode = agent.GetExecutionMode()
	}
	// If user explicitly asks to proceed, switch to action mode for this turn
	lowerInput := strings.ToLower(userInput)
	if strings.Contains(lowerInput, "proceed with plan") || strings.Contains(lowerInput, "proceed with the plan") || strings.Contains(lowerInput, "proceed to plan") {
		execMode = "action"
	}

	userInput += fmt.Sprintf("\n\n[BUILD & EXECUTION MODE: %s]\n", strings.ToUpper(execMode))
	if execMode == "plan" {
		userInput += "- You are currently in PLAN MODE. You MUST FIRST output a structured plan using <plan title=\"...\">...</plan> containing goals, markdown checklists (- [ ] ...), and proposed file edits/commands.\n- In PLAN MODE, do NOT call mutating tools (<deploy>, destructive <exec>) until the user explicitly approves by clicking Proceed.\n"
	} else {
		userInput += "- You are currently in ACTION MODE: Execute requested tools without a planning gate. Deployments still require the shared setup card; do not bypass it with shell commands.\n"
	}

	// Inject GitHub integration context if active
	if req.GitHubUsername != "" || req.GitHubToken != "" {
		ghInfo := "\n\n[GITHUB INTEGRATION ACTIVE]"
		if req.GitHubUsername != "" {
			ghInfo += fmt.Sprintf("\n- Connected GitHub user: @%s", req.GitHubUsername)
		}
		ghInfo += "\n- Saved GitHub credentials are resolved only by the shared deployment source preparation API. Open the setup card with the HTTPS repository URL. Do not clone using shell credentials or ask for tokens in chat."
		userInput += ghInfo
	}

	ai.SetSSEHeaders(w)
	w.WriteHeader(http.StatusOK)
	ai.FlushSSE(w)

	client := ai.NewWithModel(modelID)
	if strings.TrimSpace(client.Model.APIKey) == "" {
		_ = ai.WriteSSEError(w, fmt.Sprintf("API key not configured: %s does not have an API key configured. Please add your API key in Settings > AI Model Keys.", client.Model.Name))
		return
	}

	// Immediately emit an initial thinking delta so the UI indicates active reasoning right away
	_ = ai.WriteSSEThinking(w, "Analyzing workspace and planning execution...\n\n")

	ctx := r.Context()

	// Resolve real system user/host for terminal prompt display
	sysUser := os.Getenv("USER")
	if sysUser == "" {
		sysUser = os.Getenv("USERNAME") // Windows fallback
	}
	if sysUser == "" {
		sysUser = "user"
	}
	sysHost, _ := os.Hostname()
	// Strip domain suffix (e.g. "MacBook-Air.local" → "MacBook-Air")
	if idx := strings.Index(sysHost, "."); idx > 0 {
		sysHost = sysHost[:idx]
	}
	if sysHost == "" {
		sysHost = "localhost"
	}

	// toolTagRe matches ANY opening tool tag — used to find where prose ends
	toolTagRe := regexp.MustCompile(`<(exec|deploy|monitor_add|check_ports|read_file|write_file|list_dir|create_dir|delete_file)[\s/>]`)

	const maxIter = 35
	for iter := 0; iter < maxIter; iter++ {
		// Buffer the full AI response — we decide what to emit AFTER seeing the whole thing.
		// This keeps exec tags, tool XML, etc. out of the chat stream.
		stream := client.AskStream(ctx, mode, userInput, history)
		var fullText strings.Builder
		var thinkingBuf strings.Builder

		for chunk := range stream {
			switch chunk.Type {
			case "text":
				fullText.WriteString(chunk.Content)
			case "thinking":
				thinkingBuf.WriteString(chunk.Content)
				_ = ai.WriteSSEThinking(w, chunk.Content)
			case "error":
				ai.WriteSSEError(w, chunk.Err.Error())
				return
			}
		}

		if ctx.Err() != nil {
			ai.WriteSSEFinish(w)
			return
		}

		text := fullText.String()
		history = append(history, ai.HistoryEntry{Role: "assistant", Content: text})

		// Debug: log raw AI response to stderr so we can see what the AI actually produces
		fmt.Fprintf(os.Stderr, "[chat] AI iter %d raw (%.120s)\n", iter, strings.ReplaceAll(text, "\n", " "))

		// ── Detect plan block and emit plan event ─────────────────────────
		if pm := chatPlanTagRe.FindStringSubmatch(text); len(pm) > 2 {
			planTitle := strings.TrimSpace(pm[1])
			if planTitle == "" {
				planTitle = "Execution Plan"
			}
			planBody := strings.TrimSpace(pm[2])

			var checklist []string
			for _, line := range strings.Split(planBody, "\n") {
				tl := strings.TrimSpace(line)
				if strings.HasPrefix(tl, "- [ ]") || strings.HasPrefix(tl, "- [x]") || strings.HasPrefix(tl, "* [ ]") {
					item := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(tl, "- [ ]"), "* [ ]"))
					if item != "" {
						checklist = append(checklist, item)
					}
				}
			}

			_ = ai.WriteSSEEvent(w, map[string]any{
				"type":      "plan-created",
				"title":     planTitle,
				"content":   planBody,
				"checklist": checklist,
				"status":    map[bool]string{true: "pending", false: "in_progress"}[execMode == "plan"],
			})

			// If in plan mode and this is not a proceed turn, pause for user approval
			if execMode == "plan" && !strings.Contains(strings.ToLower(userInput), "proceed with plan") {
				cleanText := text
				thinkRe := regexp.MustCompile(`(?s)<think>(.*?)</think>`)
				if tm := thinkRe.FindStringSubmatch(text); len(tm) > 1 {
					_ = ai.WriteSSEThinking(w, strings.TrimSpace(tm[1])+"\n\n")
					cleanText = thinkRe.ReplaceAllString(cleanText, "")
				}
				cleanText = strings.TrimSpace(cleanText)

				if len(cleanText) > 0 {
					const chunkSize = 32
					runes := []rune(cleanText)
					for i := 0; i < len(runes); i += chunkSize {
						end := i + chunkSize
						if end > len(runes) {
							end = len(runes)
						}
						_ = ai.WriteSSETextDelta(w, string(runes[i:end]))
					}
				}
				ai.WriteSSEFinish(w)
				return
			}
		}

		// ── Detect tool (parse only — do NOT execute yet) ──────────────────
		toolName, toolArg, found := detectTool(text)
		if !found {
			// If the model had an unclosed tool tag, auto-nudge it to complete the tag
			if hasIncompleteIntent(text) && iter < maxIter-1 {
				nudge := "[SYSTEM: You emitted an unclosed tool tag. Please provide the complete tag or continue your response.]"
				history = append(history, ai.HistoryEntry{Role: "user", Content: nudge})
				userInput = nudge
				continue
			}

			// Genuine final verdict. Stream cleanly to chat.
			cleanText := text
			thinkRe := regexp.MustCompile(`(?s)<think>(.*?)</think>`)
			if m := thinkRe.FindStringSubmatch(text); len(m) > 1 {
				_ = ai.WriteSSEThinking(w, strings.TrimSpace(m[1])+"\n\n")
				cleanText = thinkRe.ReplaceAllString(cleanText, "")
			}
			cleanText = strings.TrimSpace(cleanText)

			if len(cleanText) > 0 {
				const chunkSize = 32
				runes := []rune(cleanText)
				for i := 0; i < len(runes); i += chunkSize {
					end := i + chunkSize
					if end > len(runes) {
						end = len(runes)
					}
					_ = ai.WriteSSETextDelta(w, string(runes[i:end]))
				}
			}
			ai.WriteSSEFinish(w)
			return
		}

		// For exec, toolArg IS the command string displayed in terminal.
		// For other tools, build a human-readable command string.
		cmdStr := toolArg
		if toolName == "monitor_add" {
			parts := strings.SplitN(toolArg, "|", 2)
			pName := parts[0]
			pPath := ""
			if len(parts) > 1 {
				pPath = parts[1]
			}
			cmdStr = fmt.Sprintf("monitor_add name=%q path=%q", pName, pPath)
		} else if toolName != "exec" {
			cmdStr = toolName + " " + toolArg
		}

		// ── Approval gate (non-autonomous only for dangerous/destructive commands) ──
		if toolName != "deploy" && !autonomous && agent.RequiresApproval(toolName, cmdStr) {
			// Stream prose before the tool tag (AI's reasoning)
			if loc := toolTagRe.FindStringIndex(text); loc != nil {
				prose := strings.TrimSpace(text[:loc[0]])
				if prose != "" {
					ai.WriteSSETextDelta(w, prose)
				}
			}

			// Register approval and send event to frontend (SSE blocks here)
			approvalID, approvalCh := agent.Approvals.NewRequest()

			var approvalErr error
			if toolName == "monitor_add" {
				// Parse name|path from arg
				parts := strings.SplitN(toolArg, "|", 2)
				pName := parts[0]
				pPath := ""
				if len(parts) > 1 {
					pPath = parts[1]
				}
				approvalErr = ai.WriteSSEMonitorAddRequest(w, approvalID, pName, pPath, 30)
			} else {
				approvalErr = ai.WriteSSEApprovalRequest(w, approvalID, toolName, cmdStr)
			}
			if approvalErr != nil {
				agent.Approvals.Release(approvalID)
				return
			}

			var approved bool
			select {
			case approved = <-approvalCh:
			case <-time.After(10 * time.Minute):
				agent.Approvals.Release(approvalID)
				// Tell AI it timed out, let it respond
				timeoutMsg := "[PERMISSION TIMED OUT] The approval request timed out after 10 minutes. The command was not executed."
				history = append(history, ai.HistoryEntry{Role: "user", Content: timeoutMsg})
				userInput = timeoutMsg
				continue
			case <-ctx.Done():
				agent.Approvals.Release(approvalID)
				return
			}

			if !approved {
				// Tell AI it was denied so it can respond naturally
				denialMsg := fmt.Sprintf("[PERMISSION DENIED] The user denied permission to run: %s\n\nAcknowledge this and let the user know they can run it manually or enable Autonomous Mode in Settings.", cmdStr)
				history = append(history, ai.HistoryEntry{Role: "user", Content: denialMsg})
				userInput = denialMsg
				continue // Loop: AI responds to denial
			}
			// Approved — fall through to execute
		}

		// ── Stream prose before tool as thinking/process (kept inside TopProcessAccordion) ──
		if autonomous {
			if loc := toolTagRe.FindStringIndex(text); loc != nil {
				prose := strings.TrimSpace(text[:loc[0]])
				if prose != "" {
					_ = ai.WriteSSEThinking(w, prose+"\n")
				}
			}
		}

		// ── NOW execute the tool (after permission obtained) ─────────────────
		// Emit terminal start event before tool begins running
		displayTool := toolName
		if toolName == "deploy" {
			displayTool = "deployment_setup"
			cmdStr = "Review deployment settings"
		}
		ai.WriteSSEToolStart(w, displayTool, cmdStr, sysUser, sysHost)
		toolOutput := runDetectedTool(ctx, text, toolName, toolArg, userID, req.GitHubToken, func(chunk string) {
			ai.WriteSSEToolOutput(w, chunk)
		})
		exitCode := 0
		if strings.Contains(toolOutput, "Error") {
			exitCode = 1
		}
		ai.WriteSSEToolEnd(w, exitCode)
		if toolName == "deploy" {
			ai.WriteSSETextDelta(w, "Confirm the project name and optional application address below, then start deployment. Source inspection and framework settings are automatic; any additional non-secret settings you supplied are included. Nothing has been deployed yet. Keep private Git credentials in Settings.")
			ai.WriteSSEFinish(w)
			return
		}

		// Feed result back to AI and loop
		feedbackMsg := fmt.Sprintf("[TOOL OUTPUT] %s result:\n%s\n\n[INSTRUCTION: When completing the user's request, provide a comprehensive, detailed final reply explaining the actions taken, technical configuration, status, and live URL. Do not provide a brief or single-line answer.]", toolName, toolOutput)
		if toolName == "monitor_add" {
			feedbackMsg = fmt.Sprintf("[TOOL OUTPUT] monitor_add result:\n%s\n\nReport the registration result accurately. Registration does not prove deployment, health or a live URL. Never include credentials in the response.", toolOutput)
		}
		history = append(history, ai.HistoryEntry{Role: "user", Content: feedbackMsg})
		userInput = feedbackMsg
	}

	ai.WriteSSEError(w, "agent: max iterations reached")
}

// chatTUIHandler handles POST /v1/chat/tui — same agent loop, for cohen TUI.
// Streams SSE in Vercel AI SDK format so cohen can read token-by-token.
func chatTUIHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req chatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if len(req.Messages) == 0 {
		http.Error(w, "messages required", http.StatusBadRequest)
		return
	}

	modelID := req.ModelID
	if modelID == "" {
		modelID = "MiniMax-M2.5"
	}

	// Build history
	history := make([]ai.HistoryEntry, 0, len(req.Messages)-1)
	for _, m := range req.Messages[:len(req.Messages)-1] {
		history = append(history, ai.HistoryEntry{Role: m.Role, Content: m.Content})
	}
	lastMsg := req.Messages[len(req.Messages)-1]
	userInput := lastMsg.Content

	autonomous := req.Autonomous || agent.IsAutonomousMode()

	// Inject monitor context: list all monitored projects + their log paths and real-time state
	userInput = injectMonitorContext(r.Context(), userInput, req.MonitorProjects)

	// Inject live port registry and next available free ports
	userInput = injectPortRegistryContext(userInput, req.MonitorProjects)

	ai.SetSSEHeaders(w)
	w.WriteHeader(http.StatusOK)
	ai.FlushSSE(w)

	client := ai.NewWithModel(modelID)
	if strings.TrimSpace(client.Model.APIKey) == "" {
		_ = ai.WriteSSEError(w, fmt.Sprintf("API key not configured: %s does not have an API key configured. Please add your API key in Settings > AI Model Keys.", client.Model.Name))
		return
	}
	ctx := r.Context()

	// Resolve real system user/host for terminal prompt display
	sysUser := os.Getenv("USER")
	if sysUser == "" {
		sysUser = os.Getenv("USERNAME")
	}
	if sysUser == "" {
		sysUser = "user"
	}
	sysHost, _ := os.Hostname()
	if idx := strings.Index(sysHost, "."); idx > 0 {
		sysHost = sysHost[:idx]
	}
	if sysHost == "" {
		sysHost = "localhost"
	}

	var thinkingBuf strings.Builder

	const maxIter = 35
	for iter := 0; iter < maxIter; iter++ {
		stream := client.AskStream(ctx, ai.PromptModeTUI, userInput, history)
		var fullText strings.Builder

		for chunk := range stream {
			switch chunk.Type {
			case "text":
				fullText.WriteString(chunk.Content)
				ai.WriteSSETextDelta(w, chunk.Content)
			case "thinking":
				thinkingBuf.WriteString(chunk.Content)
			case "error":
				ai.WriteSSEError(w, chunk.Err.Error())
				return
			}
		}

		if ctx.Err() != nil {
			ai.WriteSSEFinish(w)
			return
		}

		text := fullText.String()
		history = append(history, ai.HistoryEntry{Role: "assistant", Content: text})

		toolName, toolArg, found := detectTool(text)
		if !found {
			if hasIncompleteIntent(text) && iter < maxIter-1 {
				nudge := "[SYSTEM: You emitted an unclosed tool tag. Please provide the complete tag or conclude your response.]"
				history = append(history, ai.HistoryEntry{Role: "user", Content: nudge})
				userInput = nudge
				continue
			}

			// No tool — done. Flush thinking metadata then finish.
			if thinkingBuf.Len() > 0 {
				thinkingData, _ := json.Marshal(map[string]string{"thinking": thinkingBuf.String()})
				w.Write([]byte("8:" + string(thinkingData) + "\n"))
				ai.FlushSSE(w)
			}
			ai.WriteSSEFinish(w)
			return
		}

		cmdStr := toolArg
		if toolName != "exec" {
			cmdStr = toolName + " " + toolArg
		}

		if toolName != "deploy" && !autonomous && agent.RequiresApproval(toolName, cmdStr) {
			notice := fmt.Sprintf("\n\n<yellow>Permission required to run %s. Use /settings to enable Autonomous Mode.</yellow>", toolName)
			ai.WriteSSETextDelta(w, notice)
			ai.WriteSSEFinish(w)
			return
		}

		// Emit structured terminal events for TUI — same protocol as web
		displayTool := toolName
		if toolName == "deploy" {
			displayTool = "deployment_setup"
			cmdStr = "Review deployment settings"
		}
		ai.WriteSSEToolStart(w, displayTool, cmdStr, sysUser, sysHost)
		toolOutput := runDetectedTool(ctx, text, toolName, toolArg, "", req.GitHubToken, func(chunk string) {
			ai.WriteSSEToolOutput(w, chunk)
		})
		exitCode := 0
		if strings.Contains(toolOutput, "Error") {
			exitCode = 1
		}
		ai.WriteSSEToolEnd(w, exitCode)
		if toolName == "deploy" {
			ai.WriteSSETextDelta(w, "Confirm the project name and optional application address below, then start deployment. Source inspection and framework settings are automatic; any additional non-secret settings you supplied are included. Nothing has been deployed yet. Keep private Git credentials in Settings.")
			ai.WriteSSEFinish(w)
			return
		}

		feedbackMsg := fmt.Sprintf("[TOOL OUTPUT] %s result:\n%s", toolName, toolOutput)
		history = append(history, ai.HistoryEntry{Role: "user", Content: feedbackMsg})
		userInput = feedbackMsg
	}

	ai.WriteSSEError(w, "agent: max iterations reached")
}

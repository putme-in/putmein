package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"brain/server/internal/monitor"
)

// ─── Request/Response types ───────────────────────────────────────────────────

type addProjectRequest struct {
	UserID      string `json:"userId"`
	Name        string `json:"name"`
	ProjectPath string `json:"projectPath"`
	LogCommand  string `json:"logCommand,omitempty"`
	IntervalSec int    `json:"intervalSec,omitempty"`
}

type updateProjectRequest struct {
	Enabled     *bool   `json:"enabled,omitempty"`
	IntervalSec *int    `json:"intervalSec,omitempty"`
	Name        *string `json:"name,omitempty"`
	LogCommand  *string `json:"logCommand,omitempty"`
}

// ─── Monitor project handlers ─────────────────────────────────────────────────

// GET /v1/monitor/projects
func monitorListProjectsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if monitor.Global == nil {
		writeJSON(w, map[string]interface{}{"projects": []interface{}{}})
		return
	}
	projects := monitor.Global.ListProjects()
	if projects == nil {
		projects = []*monitor.Project{}
	}
	writeJSON(w, map[string]interface{}{"projects": projects})
}

// POST /v1/monitor/projects
func monitorAddProjectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if monitor.Global == nil {
		http.Error(w, "monitor service not started", http.StatusServiceUnavailable)
		return
	}

	var req addProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.ProjectPath == "" {
		http.Error(w, "name and projectPath are required", http.StatusBadRequest)
		return
	}

	if req.IntervalSec <= 0 {
		req.IntervalSec = 30
	}

	p := &monitor.Project{
		UserID:      req.UserID,
		Name:        req.Name,
		ProjectPath: req.ProjectPath,
		LogCommand:  req.LogCommand,
		IntervalSec: req.IntervalSec,
		Enabled:     true,
		Status:      monitor.StatusDiscovering,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	saved, err := monitor.Global.AddProject(r.Context(), p)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to add project: %v", err), http.StatusInternalServerError)
		return
	}

	// Include running process info and suggested start command in response
	processes := monitor.DetectRunningProcesses(r.Context(), req.ProjectPath)
	suggestedCmd := monitor.DetectStartCommand(req.ProjectPath)

	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]interface{}{
		"project":          saved,
		"runningProcesses": processes,
		"suggestedCommand": suggestedCmd,
	})
}

// PATCH /v1/monitor/projects/{id}
func monitorUpdateProjectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/v1/monitor/projects/")
	id = strings.TrimSuffix(id, "/")
	if id == "" {
		http.Error(w, "project id required", http.StatusBadRequest)
		return
	}

	var req updateProjectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	if monitor.Global == nil {
		http.Error(w, "monitor service not started", http.StatusServiceUnavailable)
		return
	}

	monitor.Global.UpdateProject(id, req.Enabled, req.IntervalSec, nil)

	// Handle pause/resume
	if req.Enabled != nil {
		if !*req.Enabled {
			monitor.Global.PauseProject(id)
		} else {
			monitor.Global.ResumeProject(r.Context(), id)
		}
	}

	writeJSON(w, map[string]interface{}{"ok": true})
}

// GET /v1/monitor/projects/{id}/logs?lines=100&path=...
func monitorGetProjectLogsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract ID from path: /v1/monitor/projects/{id}/logs
	pathWithoutPrefix := strings.TrimPrefix(r.URL.Path, "/v1/monitor/projects/")
	parts := strings.SplitN(pathWithoutPrefix, "/", 2)
	id := parts[0]
	if id == "" {
		http.Error(w, "project id required", http.StatusBadRequest)
		return
	}

	lines := 100
	if linesStr := r.URL.Query().Get("lines"); linesStr != "" {
		if n, err := strconv.Atoi(linesStr); err == nil && n > 0 && n <= 1000 {
			lines = n
		}
	}

	type logFile struct {
		Path    string `json:"path"`
		Content string `json:"content"`
		Error   string `json:"error,omitempty"`
	}

	var paths []string
	projectName := ""

	// Check in-memory Global projects
	if monitor.Global != nil {
		if p, ok := monitor.Global.GetProject(id); ok {
			paths = append(paths, p.LogPaths...)
			projectName = p.Name
		}
	}

	// Check managed processes
	mp := monitor.GetManagedProcess(id)
	if mp != nil && mp.LogFile != "" {
		hasMpLog := false
		for _, p := range paths {
			if p == mp.LogFile {
				hasMpLog = true
				break
			}
		}
		if !hasMpLog {
			paths = append([]string{mp.LogFile}, paths...)
		}
		if projectName == "" {
			projectName = filepath.Base(mp.ProjectPath)
		}
	}

	// Check explicit path in query params
	if explicitPath := r.URL.Query().Get("path"); explicitPath != "" {
		hasExplicit := false
		for _, p := range paths {
			if p == explicitPath {
				hasExplicit = true
				break
			}
		}
		if !hasExplicit {
			paths = append([]string{explicitPath}, paths...)
		}
	}

	// Check if a Docker container is running for this project
	if container := monitor.DetectDockerContainer(r.Context(), projectName, ""); container != nil {
		dockerPath := "docker:" + container.Name
		hasDocker := false
		for _, p := range paths {
			if p == dockerPath {
				hasDocker = true
				break
			}
		}
		if !hasDocker {
			paths = append([]string{dockerPath}, paths...)
		}
	}

	result := make([]logFile, 0, len(paths))
	for _, path := range paths {
		content, err := monitor.ReadFileTail(path, lines)
		if err != nil {
			result = append(result, logFile{Path: path, Error: err.Error()})
			continue
		}
		result = append(result, logFile{
			Path:    path,
			Content: content,
		})
	}

	writeJSON(w, map[string]interface{}{
		"projectId": id,
		"name":      projectName,
		"logs":      result,
	})
}

// DELETE /v1/monitor/projects/{id}
func monitorDeleteProjectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/v1/monitor/projects/")
	id = strings.TrimSuffix(id, "/")
	if id == "" {
		http.Error(w, "project id required", http.StatusBadRequest)
		return
	}

	if monitor.Global != nil {
		monitor.Global.RemoveProject(id)
	}

	writeJSON(w, map[string]interface{}{"ok": true})
}

// ─── Monitor alert handlers ────────────────────────────────────────────────────

// monitorAlertsHandler is a placeholder — real alert data is managed via Next.js API routes
// that query the Prisma DB. Brain's handler just provides the real-time SSE stream.
func monitorAlertsHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]interface{}{"message": "Use /api/monitor/alerts via the Next.js API"})
}

// ─── SSE stream handler ────────────────────────────────────────────────────────

// GET /v1/monitor/stream  — SSE stream of real-time alert events
func monitorStreamHandler(w http.ResponseWriter, r *http.Request) {
	if monitor.Global == nil {
		http.Error(w, "monitor service not started", http.StatusServiceUnavailable)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	sub := monitor.Global.Subscribe()
	defer monitor.Global.Unsubscribe(sub)

	// Send a ping to confirm connection
	fmt.Fprintf(w, "event: ping\ndata: connected\n\n")
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case alert, ok := <-sub:
			if !ok {
				return
			}
			data, err := json.Marshal(alert)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: alert\ndata: %s\n\n", data)
			flusher.Flush()
		}
	}
}

// writeJSON is a shared helper (also used by existing handlers).
func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// writeJSONError is a helper to return a structured JSON error response.
func writeJSONError(w http.ResponseWriter, message string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// GET /v1/monitor/process/detect?path=/project/path&id=...
func monitorDetectProcessHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	projectPath := r.URL.Query().Get("path")
	projectID := r.URL.Query().Get("id")

	var processes []monitor.RunningProcess
	suggestedCmd := ""
	if projectPath != "" {
		processes = monitor.DetectRunningProcesses(r.Context(), projectPath)
		suggestedCmd = monitor.DetectStartCommand(projectPath)
	}

	var managedPid int
	var managedLogFile string
	var managedPort int
	var managedURL string
	if projectID != "" {
		if mp := monitor.GetManagedProcess(projectID); mp != nil {
			managedPid = mp.PID
			managedLogFile = mp.LogFile
			managedPort = mp.Port
			managedURL = mp.URL
		}
	}

	projectName := r.URL.Query().Get("name")
	if projectName == "" && projectPath != "" {
		projectName = filepath.Base(projectPath)
	}

	var container *monitor.DockerContainerInfo
	if projectName != "" || projectPath != "" {
		container = monitor.DetectDockerContainer(r.Context(), projectName, projectPath)
	}

	if container != nil {
		if managedPort == 0 && container.Port > 0 {
			managedPort = container.Port
		}
		if managedURL == "" && container.URL != "" {
			managedURL = container.URL
		}
	}

	writeJSON(w, map[string]interface{}{
		"processes":        processes,
		"suggestedCommand": suggestedCmd,
		"managedPid":       managedPid,
		"managedLogFile":   managedLogFile,
		"managedPort":      managedPort,
		"managedUrl":       managedURL,
		"container":        container,
	})
}

// POST /v1/monitor/process/spawn
type spawnRequest struct {
	ProjectID   string `json:"projectId"`
	ProjectPath string `json:"projectPath"`
	Command     string `json:"command"`
	KillPID     int    `json:"killPid,omitempty"`
}

func monitorSpawnProcessHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req spawnRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.ProjectID == "" || req.ProjectPath == "" || req.Command == "" {
		http.Error(w, "projectId, projectPath, and command are required", http.StatusBadRequest)
		return
	}

	mp, err := monitor.SpawnManagedProcess(r.Context(), req.ProjectID, req.ProjectPath, req.Command, req.KillPID)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to spawn: %v", err), http.StatusInternalServerError)
		return
	}

	// Tell the monitor service about the new log file so it gets tailed
	if monitor.Global != nil {
		monitor.Global.AddLogPath(req.ProjectID, mp.LogFile)
	}

	writeJSON(w, map[string]interface{}{
		"pid":     mp.PID,
		"logFile": mp.LogFile,
		"command": mp.Command,
		"port":    mp.Port,
		"url":     mp.URL,
	})
}

// POST /v1/monitor/process/stop
func monitorStopProcessHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		ProjectID string `json:"projectId"`
		PID       int    `json:"pid,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if body.ProjectID != "" {
		monitor.StopManagedProcess(body.ProjectID)
	}
	if body.PID > 0 {
		monitor.KillPID(r.Context(), body.PID)
	}
	writeJSON(w, map[string]interface{}{"ok": true})
}

// POST /v1/monitor/projects/{id}/diagnose
func monitorDiagnoseHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ModelID     string `json:"modelId,omitempty"`
		ProjectPath string `json:"projectPath"`
		Command     string `json:"command,omitempty"`
		Logs        string `json:"logs,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.ProjectPath) == "" && strings.TrimSpace(req.Logs) == "" {
		writeJSONError(w, "projectPath or logs are required", http.StatusBadRequest)
		return
	}

	diag, err := monitor.DiagnoseProject(r.Context(), req.ModelID, req.ProjectPath, req.Command, req.Logs)
	if err != nil {
		writeJSONError(w, fmt.Sprintf("diagnosis failed: %v", err), http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]interface{}{
		"diagnosis": diag,
	})
}

// POST /v1/monitor/projects/{id}/fix
func monitorFixHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ProjectID    string   `json:"projectId,omitempty"`
		ProjectPath  string   `json:"projectPath"`
		Commands     []string `json:"commands"`
		StartCommand string   `json:"startCommand,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.ProjectPath == "" {
		http.Error(w, "projectPath is required", http.StatusBadRequest)
		return
	}

	// Extract ID from path if not in body
	if req.ProjectID == "" {
		trimmed := strings.TrimPrefix(r.URL.Path, "/v1/monitor/projects/")
		trimmed = strings.TrimSuffix(trimmed, "/fix")
		req.ProjectID = trimmed
	}

	res, err := monitor.ExecuteFix(r.Context(), req.ProjectID, req.ProjectPath, req.Commands, req.StartCommand)
	if err != nil {
		http.Error(w, fmt.Sprintf("fix execution error: %v", err), http.StatusInternalServerError)
		return
	}

	writeJSON(w, res)
}

// monitorProjectsRouteHandler dispatches based on whether an ID is present.
func monitorProjectsRouteHandler(w http.ResponseWriter, r *http.Request) {
	// /v1/monitor/process/*
	if strings.HasPrefix(r.URL.Path, "/v1/monitor/process/") {
		sub := strings.TrimPrefix(r.URL.Path, "/v1/monitor/process/")
		switch sub {
		case "detect":
			monitorDetectProcessHandler(w, r)
		case "spawn":
			monitorSpawnProcessHandler(w, r)
		case "stop":
			monitorStopProcessHandler(w, r)
		default:
			http.NotFound(w, r)
		}
		return
	}
	// /v1/monitor/projects  (no trailing ID)
	if r.URL.Path == "/v1/monitor/projects" || r.URL.Path == "/v1/monitor/projects/" {
		switch r.Method {
		case http.MethodGet:
			monitorListProjectsHandler(w, r)
		case http.MethodPost:
			monitorAddProjectHandler(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}
	// /v1/monitor/projects/{id}/logs
	if strings.HasSuffix(r.URL.Path, "/logs") {
		monitorGetProjectLogsHandler(w, r)
		return
	}
	// /v1/monitor/projects/{id}/diagnose
	if strings.HasSuffix(r.URL.Path, "/diagnose") {
		monitorDiagnoseHandler(w, r)
		return
	}
	// /v1/monitor/projects/{id}/fix
	if strings.HasSuffix(r.URL.Path, "/fix") {
		monitorFixHandler(w, r)
		return
	}
	// /v1/monitor/projects/{id}
	switch r.Method {
	case http.MethodPatch:
		monitorUpdateProjectHandler(w, r)
	case http.MethodDelete:
		monitorDeleteProjectHandler(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

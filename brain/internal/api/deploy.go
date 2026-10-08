package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"brain/server/internal/ai"
	"brain/server/internal/deploy"
)

// deployHandler handles POST /v1/deploy — runs containerized build & deployment and streams SSE.
func deployHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req deploy.DeployRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.ProjectPath == "" {
		http.Error(w, "name and projectPath are required", http.StatusBadRequest)
		return
	}

	ai.SetSSEHeaders(w)
	w.WriteHeader(http.StatusOK)
	ai.FlushSSE(w)

	// Emit SSE helper
	emit := func(ev deploy.DeployStepEvent) {
		data, err := json.Marshal(ev)
		if err == nil {
			fmt.Fprintf(w, "data: %s\n\n", data)
			ai.FlushSSE(w)
		}
	}

	_, err := deploy.ExecuteDeployment(r.Context(), req, emit)
	if err != nil {
		emit(deploy.DeployStepEvent{
			Step:    deploy.StepFailed,
			Status:  "error",
			Message: fmt.Sprintf("Deployment failed: %v", err),
		})
	}
}

// deployLogsHandler handles GET /v1/deploy/logs?container=...&lines=...
func deployLogsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	container := r.URL.Query().Get("container")
	if container == "" {
		http.Error(w, "container parameter required", http.StatusBadRequest)
		return
	}

	lines := 200
	if lStr := r.URL.Query().Get("lines"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 {
			lines = l
		}
	}

	logs, err := deploy.GetContainerLogs(container, lines)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to get container logs: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"container": container,
		"logs":      logs,
	})
}

// deployActionHandler handles POST /v1/deploy/action (restart / stop)
func deployActionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		DeletionToken string   `json:"deletionToken"`
		Completed     bool     `json:"completed"`
		UserID        string   `json:"userId"`
		DeploymentID  string   `json:"deploymentId"`
		ProjectID     string   `json:"projectId"`
		ProjectPath   string   `json:"projectPath"`
		Apply         bool     `json:"apply"`
		Paths         []string `json:"paths"`
		Action        string   `json:"action"` // "restart" | "stop"
		Container     string   `json:"container"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Action == "begin-delete" {
		token, err := deploy.BeginProjectDeletion(req.UserID, req.ProjectID)
		if err != nil {
			http.Error(w, err.Error(), 409)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"token": token})
		return
	}
	if req.Action == "finish-delete" {
		if err := deploy.FinishProjectDeletion(req.DeletionToken, req.Completed); err != nil {
			http.Error(w, err.Error(), 409)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		return
	}
	if req.Action != "cancel" {
		release, err := deploy.AcquireOperation(req.DeletionToken)
		if err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		defer release()
	}
	var err error
	switch req.Action {
	case "cleanup", "releases":
		if req.UserID == "" || req.ProjectID == "" {
			http.Error(w, "owner and project required", 400)
			return
		}
		project := deploy.DeployRequest{UserID: req.UserID, ProjectID: req.ProjectID, ProjectPath: req.ProjectPath}
		w.Header().Set("Content-Type", "application/json")
		if req.Action == "releases" {
			items, e := deploy.ListReleaseArtifacts(project)
			if e != nil {
				http.Error(w, e.Error(), 500)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"releases": items})
			return
		}
		items, e := deploy.CleanupProject(project, req.Apply, req.Paths)
		if e != nil {
			http.Error(w, e.Error(), 500)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
		return
	case "rollback":
		if e := deploy.ValidateRecoveryOwner(req.Container, req.UserID, req.ProjectID); e != nil {
			err = e
			break
		}
		result, e := deploy.RollbackRuntime(req.Container, req.DeploymentID)
		if e != nil {
			err = e
			break
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"result": result})
		return
	case "recover":
		if e := deploy.ValidateRecoveryOwner(req.Container, req.UserID, req.ProjectID); e != nil {
			err = e
			break
		}
		if strings.HasPrefix(req.Container, "process:") {
			err = deploy.RecoverHostReplacement(req.Container)
		} else {
			err = deploy.RecoverDockerReplacement(req.Container)
		}
	case "unroute":
		err = deploy.RemoveRuntimeRoute(r.Context(), req.Container)
	case "cancel":
		if !deploy.CancelDeployment(req.UserID, req.DeploymentID) {
			err = fmt.Errorf("no active deployment to cancel; refresh and retry")
		}
	case "restart":
		err = deploy.RestartContainer(req.Container)
	case "stop":
		err = deploy.StopContainer(req.Container)
	case "remove":
		if strings.HasPrefix(req.Container, "process:") {
			err = deploy.RemoveHostRuntime(req.Container)
		} else {
			err = deploy.StopContainer(req.Container)
		}
	default:
		http.Error(w, "invalid action (restart or stop)", http.StatusBadRequest)
		return
	}

	if err != nil {
		http.Error(w, fmt.Sprintf("action failed: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

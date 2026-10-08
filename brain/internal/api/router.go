package api

import (
	"net/http"
	"os"
	"strings"
)

// isAllowedOrigin checks if the request origin matches the allowlist of trusted PutmeIn/Ray frontends.
func isAllowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}

	// Always permit local Ray UI origins
	if origin == "http://localhost:3000" || origin == "http://127.0.0.1:3000" {
		return true
	}

	// Permit origin configured in RAY_URL
	if rayURL := strings.TrimRight(os.Getenv("RAY_URL"), "/"); rayURL != "" && origin == rayURL {
		return true
	}

	// Permit any extra origins listed in BRAIN_ALLOWED_ORIGINS (comma-separated)
	if extra := os.Getenv("BRAIN_ALLOWED_ORIGINS"); extra != "" {
		for _, o := range strings.Split(extra, ",") {
			if strings.TrimSpace(o) == origin {
				return true
			}
		}
	}

	return false
}

// corsMiddleware applies restrictive CORS policies, allowing only trusted PutmeIn origins.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		if origin != "" && isAllowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-brain-secret, x-internal-secret")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}

		if r.Method == http.MethodOptions {
			if origin != "" && !isAllowedOrigin(origin) {
				http.Error(w, "CORS origin not allowed", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// NewRouter builds and returns the brain HTTP router.
func NewRouter() http.Handler {
	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("/health", healthHandler)

	// Models
	mux.HandleFunc("/v1/models", modelsHandler)

	// Chat (streaming SSE — for ray web)
	mux.HandleFunc("/v1/chat", chatStreamHandler)

	// Chat TUI (streaming SSE in TUI mode — for cohen)
	mux.HandleFunc("/v1/chat/tui", chatTUIHandler)

	// Approval back-channel — frontend POSTs here to resolve pending approvals
	mux.HandleFunc("/v1/chat/approve", approveHandler)

	// Agent
	mux.HandleFunc("/v1/agent", agentHandler)
	mux.HandleFunc("/v1/agent/autonomous", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			autonomousStatusHandler(w, r)
		case http.MethodPost:
			autonomousHandler(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// Settings (autonomous mode, deployment directory)
	mux.HandleFunc("/v1/settings", settingsHandler)

	// Standalone title generation
	mux.HandleFunc("/v1/title", sessionsGenerateTitleHandler)

	// Sessions (all /v1/sessions/* routed through sessionsRouteHandler)
	mux.HandleFunc("/v1/sessions", sessionsRouteHandler)
	mux.HandleFunc("/v1/sessions/", func(w http.ResponseWriter, r *http.Request) {
		// Ensure the path starts with /v1/sessions/
		if !strings.HasPrefix(r.URL.Path, "/v1/sessions/") {
			http.NotFound(w, r)
			return
		}
		sessionsRouteHandler(w, r)
	})

	// Monitor routes
	mux.HandleFunc("/v1/monitor/stream", monitorStreamHandler)
	mux.HandleFunc("/v1/monitor/projects", monitorProjectsRouteHandler)
	mux.HandleFunc("/v1/monitor/projects/", monitorProjectsRouteHandler)
	mux.HandleFunc("/v1/monitor/process/", monitorProjectsRouteHandler) // process detect/spawn/stop
	mux.HandleFunc("/v1/monitor/alerts", monitorAlertsHandler)

	// Security routes
	mux.HandleFunc("/v1/security/scan", requireInternalSecret(securityScanHandler))
	mux.HandleFunc("/v1/security/advanced", requireInternalSecret(securityAdvancedHandler))
	mux.HandleFunc("/v1/security/rules", securityRulesHandler)
	mux.HandleFunc("/v1/security/scans", securityScansHandler)

	mux.HandleFunc("/v1/monitor/config", requireInternalSecret(monitorConfigHandler))

	mux.HandleFunc("/v1/deploy/legacy", requireInternalSecret(legacyArtifactsHandler))

	// Deploy routes
	mux.HandleFunc("/v1/deploy", requireInternalSecret(deployHandler))
	mux.HandleFunc("/v1/deploy/logs", requireInternalSecret(deployLogsHandler))
	mux.HandleFunc("/v1/deploy/action", requireInternalSecret(deployActionHandler))

	// Ports route (real-time port discovery and allocation)
	mux.HandleFunc("/v1/ports", portsHandler)

	// Project explorer routes
	mux.HandleFunc("/v1/projects/files", projectsFilesHandler)
	mux.HandleFunc("/v1/projects/file-content", projectsFileContentHandler)
	mux.HandleFunc("/v1/projects/analyze", projectsAnalyzeHandler)

	// Container routes
	mux.HandleFunc("/v1/containers", requireInternalSecret(containersListHandler))
	mux.HandleFunc("/v1/containers/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if strings.HasSuffix(path, "/logs") {
			requireInternalSecret(containerLogsHandler)(w, r)
		} else if strings.Contains(path, "/start") || strings.Contains(path, "/stop") || strings.Contains(path, "/restart") || strings.Contains(path, "/remove") || strings.Contains(path, "/rm") {
			requireInternalSecret(containerActionHandler)(w, r)
		} else {
			requireInternalSecret(containerInspectHandler)(w, r)
		}
	})

	// Terminal routes (interactive host and container execution) - requires internal secret auth
	mux.HandleFunc("/v1/terminal/exec", requireInternalSecret(terminalExecHandler))
	mux.HandleFunc("/v1/terminal/stream", requireInternalSecret(terminalStreamHandler))

	return corsMiddleware(mux)
}

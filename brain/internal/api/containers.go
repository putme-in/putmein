package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"brain/server/internal/monitor"
)

var (
	statsCacheMu      sync.RWMutex
	cachedStatsMap    = make(map[string][2]string)
	lastStatsFetch    time.Time
	isStatsRefreshing bool
)

// getCachedDockerStats returns container [CPU, Memory] stats from a 15-second in-memory cache.
// If forceSync is false and cache is expired, it kicks off a background goroutine to refresh
// so HTTP requests never block for 2+ seconds on `docker stats`.
func getCachedDockerStats(forceSync bool) map[string][2]string {
	statsCacheMu.RLock()
	now := time.Now()
	isFresh := now.Sub(lastStatsFetch) < 15*time.Second && len(cachedStatsMap) > 0
	if isFresh {
		res := make(map[string][2]string, len(cachedStatsMap))
		for k, v := range cachedStatsMap {
			res[k] = v
		}
		statsCacheMu.RUnlock()
		return res
	}
	shouldTriggerRefresh := !isStatsRefreshing
	statsCacheMu.RUnlock()

	refreshFn := func() {
		statsCacheMu.Lock()
		if isStatsRefreshing {
			statsCacheMu.Unlock()
			return
		}
		isStatsRefreshing = true
		statsCacheMu.Unlock()

		defer func() {
			statsCacheMu.Lock()
			isStatsRefreshing = false
			statsCacheMu.Unlock()
		}()

		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		statsOut, err := monitor.RunLogCommand(ctx, `docker stats --no-stream --format "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"`)
		if err == nil && strings.TrimSpace(statsOut) != "" {
			newMap := make(map[string][2]string)
			for _, sLine := range strings.Split(strings.TrimSpace(statsOut), "\n") {
				parts := strings.Split(sLine, "\t")
				if len(parts) >= 3 {
					newMap[parts[0]] = [2]string{parts[1], parts[2]}
				}
			}
			statsCacheMu.Lock()
			cachedStatsMap = newMap
			lastStatsFetch = time.Now()
			statsCacheMu.Unlock()
		}
	}

	if forceSync {
		refreshFn()
	} else if shouldTriggerRefresh {
		go refreshFn()
	}

	statsCacheMu.RLock()
	defer statsCacheMu.RUnlock()
	res := make(map[string][2]string, len(cachedStatsMap))
	for k, v := range cachedStatsMap {
		res[k] = v
	}
	return res
}

// ContainerSummary describes a Docker container
type ContainerSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Image     string `json:"image"`
	Status    string `json:"status"` // "Up 12 minutes", "Exited (0) 5 minutes ago"
	State     string `json:"state"`  // "running" | "exited" | "paused" | "restarting"
	Ports     string `json:"ports"`
	Port      int    `json:"port,omitempty"`
	URL       string `json:"url,omitempty"`
	CreatedAt string `json:"createdAt"`
	CPU       string `json:"cpu,omitempty"`
	Memory    string `json:"memory,omitempty"`
	IsRay     bool   `json:"isRay"`
}

// GET /v1/containers
func containersListHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	out, err := monitor.RunLogCommand(r.Context(), `docker ps -a --format "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.CreatedAt}}"`)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"containers": []ContainerSummary{},
			"error":      "Docker daemon not running or unavailable",
		})
		return
	}

	// Retrieve stats from fast in-memory cache (15s TTL) to prevent locking the Docker daemon
	statsMap := getCachedDockerStats(r.URL.Query().Get("stats") == "true")

	var containers []ContainerSummary
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
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
		cCreated := ""
		if len(parts) > 5 {
			cCreated = parts[5]
		}

		state := "running"
		if strings.HasPrefix(strings.ToLower(cStatus), "exited") {
			state = "exited"
		} else if strings.HasPrefix(strings.ToLower(cStatus), "paused") {
			state = "paused"
		} else if strings.HasPrefix(strings.ToLower(cStatus), "restart") {
			state = "restarting"
		}

		port := 0
		url := ""
		portRe := regexp.MustCompile(`(?:(?:\d{1,3}\.){3}\d{1,3}|\[?::\]?|0\.0\.0\.0)?:?(\d+)->`)
		if m := portRe.FindStringSubmatch(cPorts); len(m) > 1 {
			port, _ = strconv.Atoi(m[1])
			if port > 0 {
				url = fmt.Sprintf("http://localhost:%d", port)
			}
		}

		cpu := ""
		mem := ""
		if st, ok := statsMap[cName]; ok {
			cpu = st[0]
			mem = st[1]
		}

		containers = append(containers, ContainerSummary{
			ID:        cID,
			Name:      cName,
			Image:     cImage,
			Status:    cStatus,
			State:     state,
			Ports:     cPorts,
			Port:      port,
			URL:       url,
			CreatedAt: cCreated,
			CPU:       cpu,
			Memory:    mem,
			IsRay:     strings.HasPrefix(cName, "ray-"),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"containers": containers,
	})
}

// GET /v1/containers/{id} or {name}
func containerInspectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/v1/containers/")
	if id == "" {
		http.Error(w, "container id required", http.StatusBadRequest)
		return
	}

	out, err := monitor.RunLogCommand(r.Context(), fmt.Sprintf("docker inspect %s", shellQuote(id)))
	if err != nil || strings.TrimSpace(out) == "" || out == "[]" {
		http.Error(w, "container not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(out))
}

// POST /v1/containers/{id}/action
func containerActionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	trimmed := strings.TrimPrefix(r.URL.Path, "/v1/containers/")
	parts := strings.Split(trimmed, "/")
	if len(parts) < 2 {
		http.Error(w, "invalid container action path", http.StatusBadRequest)
		return
	}
	id := parts[0]
	action := parts[1] // "start" | "stop" | "restart" | "remove"

	var cmd string
	switch action {
	case "start":
		cmd = fmt.Sprintf("docker start %s", shellQuote(id))
	case "stop":
		cmd = fmt.Sprintf("docker stop %s", shellQuote(id))
	case "restart":
		cmd = fmt.Sprintf("docker restart %s", shellQuote(id))
	case "remove", "rm":
		cmd = fmt.Sprintf("docker rm -f %s", shellQuote(id))
	default:
		http.Error(w, "invalid action: "+action, http.StatusBadRequest)
		return
	}

	out, err := monitor.RunLogCommand(r.Context(), cmd)
	if err != nil {
		http.Error(w, fmt.Sprintf("action failed: %s (%v)", out, err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":     true,
		"action": action,
		"id":     id,
		"output": out,
	})
}

// GET /v1/containers/{id}/logs?lines=300
func containerLogsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	trimmed := strings.TrimPrefix(r.URL.Path, "/v1/containers/")
	parts := strings.Split(trimmed, "/")
	if len(parts) < 2 {
		http.Error(w, "invalid container logs path", http.StatusBadRequest)
		return
	}
	id := parts[0]

	lines := 300
	if lStr := r.URL.Query().Get("lines"); lStr != "" {
		if n, err := strconv.Atoi(lStr); err == nil && n > 0 && n <= 2000 {
			lines = n
		}
	}

	out, err := monitor.RunLogCommand(r.Context(), fmt.Sprintf("docker logs --tail %d %s 2>&1", lines, shellQuote(id)))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"id":    id,
			"logs":  "",
			"error": out,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"id":   id,
		"logs": out,
	})
}

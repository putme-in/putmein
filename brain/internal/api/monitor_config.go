package api

import (
	"brain/server/internal/monitor"
	"encoding/json"
	"net/http"
)

func monitorConfigHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	var body struct {
		Owner   string                   `json:"userId"`
		Project string                   `json:"projectId"`
		Action  string                   `json:"action"`
		Config  monitor.MonitoringConfig `json:"config"`
		Sample  string                   `json:"sample"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 128*1024)).Decode(&body) != nil || body.Owner == "" || body.Project == "" {
		http.Error(w, "invalid monitor configuration request", 400)
		return
	}
	switch body.Action {
	case "get":
		config, err := monitor.LoadMonitoringConfig(body.Owner, body.Project)
		if err != nil {
			http.Error(w, "saved monitoring configuration needs repair", 500)
			return
		}
		writeJSON(w, map[string]any{"config": config})
	case "save", "preview":
		if err := monitor.ValidateMonitoringConfig(body.Config); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if body.Action == "save" {
			if err := monitor.SaveMonitoringConfig(body.Owner, body.Project, body.Config); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			writeJSON(w, map[string]any{"config": body.Config})
			return
		}
		if len(body.Sample) > 8192 {
			http.Error(w, "sample is limited to 8 KiB", 400)
			return
		}
		writeJSON(w, map[string]any{"matches": monitor.MatchConfiguredLogs(body.Config, body.Sample)})
	default:
		http.Error(w, "invalid action", 400)
	}
}

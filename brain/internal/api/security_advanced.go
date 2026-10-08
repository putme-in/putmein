package api

import (
	"brain/server/internal/security"
	"encoding/json"
	"net/http"
	"os/exec"
)

func securityAdvancedHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var config security.AdvancedConfig
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&config) != nil {
			http.Error(w, "invalid settings", 400)
			return
		}
		if err := security.SaveAdvancedConfig(config); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
	} else if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", 405)
		return
	}
	config, err := security.LoadAdvancedConfig()
	if err != nil {
		http.Error(w, "advanced security configuration unavailable", 500)
		return
	}
	_, err = exec.LookPath("trivy")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"config": config, "scannerAvailable": err == nil})
}

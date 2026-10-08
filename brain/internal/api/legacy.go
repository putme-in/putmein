package api

import (
	"brain/server/internal/deploy"
	"context"
	"encoding/json"
	"net/http"
	"time"
)

func legacyArtifactsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	var req deploy.LegacyRequest
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024*1024)).Decode(&req) != nil {
		http.Error(w, "invalid legacy review request", 400)
		return
	}
	if req.Action != "preview" && req.Action != "quarantine" && req.Action != "restore" && req.Action != "delete-quarantine" && req.Action != "remove-docker" {
		http.Error(w, "invalid action", 400)
		return
	}
	release, err := deploy.AcquireOperation()
	if err != nil {
		http.Error(w, err.Error(), 409)
		return
	}
	defer release()
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	if req.Action == "preview" {
		items, err := deploy.LegacyReview(ctx, req)
		if err != nil {
			http.Error(w, err.Error(), 409)
			return
		}
		writeJSON(w, map[string]any{"items": items})
		return
	}
	results, err := deploy.LegacyApply(ctx, req)
	if err != nil {
		http.Error(w, err.Error(), 409)
		return
	}
	writeJSON(w, map[string]any{"results": results})
}

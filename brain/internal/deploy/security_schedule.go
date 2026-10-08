package deploy

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"brain/server/internal/security"
)

type scanTarget struct {
	UserID      string `json:"userId"`
	ProjectID   string `json:"projectId"`
	ProjectName string `json:"projectName"`
	ProjectPath string `json:"projectPath"`
	ContainerID string `json:"containerId"`
}
type scheduleState struct {
	AttemptedAt    time.Time                `json:"attemptedAt"`
	Pending        *security.SecurityReport `json:"pending,omitempty"`
	NextDeliveryAt time.Time                `json:"nextDeliveryAt,omitempty"`
}

func scheduledDue(state scheduleState, hours int, now time.Time) bool {
	if state.Pending != nil {
		return !now.Before(state.NextDeliveryAt)
	}
	return state.AttemptedAt.IsZero() || now.Sub(state.AttemptedAt) >= time.Duration(hours)*time.Hour
}
func StartSecurityRescans(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runScheduledScans(ctx)
			}
		}
	}()
}
func runScheduledScans(ctx context.Context) {
	config, err := security.LoadAdvancedConfig()
	if err != nil {
		log.Printf("[security] scheduler settings unavailable: %v", err)
		return
	}
	if config.RescanHours == 0 {
		return
	}
	rayURL := os.Getenv("RAY_URL")
	if rayURL == "" {
		rayURL = "http://localhost:3000"
	}
	req, err := http.NewRequestWithContext(ctx, "GET", rayURL+"/api/security/internal/targets", nil)
	if err != nil {
		return
	}
	req.Header.Set("x-brain-secret", os.Getenv("BRAIN_INTERNAL_SECRET"))
	response, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		log.Printf("[security] cannot fetch scheduled targets: %v", err)
		return
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		log.Printf("[security] target inventory rejected: %d", response.StatusCode)
		return
	}
	var payload struct {
		Targets []scanTarget `json:"targets"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 4*1024*1024)).Decode(&payload) != nil || len(payload.Targets) > 2000 {
		log.Printf("[security] invalid target inventory")
		return
	}
	processed := 0
	for _, target := range payload.Targets {
		currentPolicy, policyErr := security.LoadAdvancedConfig()
		if policyErr != nil || currentPolicy.RescanHours == 0 {
			return
		}
		if ctx.Err() != nil {
			return
		}
		if target.UserID == "" || target.ProjectID == "" || target.ProjectPath == "" {
			continue
		}
		key := sha256.Sum256([]byte(target.UserID + "\x00" + target.ProjectID))
		filename := filepath.Join(security.AdvancedRoot(), "schedules", hex.EncodeToString(key[:])+".json")
		release, err := AcquireOperation()
		if err != nil {
			return
		}
		func() {
			defer release()
			var state scheduleState
			raw, err := os.ReadFile(filename)
			if err != nil && !os.IsNotExist(err) {
				log.Printf("[security] schedule state unavailable: %v", err)
				return
			}
			if err == nil && json.Unmarshal(raw, &state) != nil {
				log.Printf("[security] corrupt schedule preserved for %s", target.ProjectID)
				return
			}
			if !scheduledDue(state, currentPolicy.RescanHours, time.Now()) {
				return
			}
			processed++
			if state.Pending == nil {
				// Resolve the active source again after acquiring the lifecycle lock.
				freshReq, e := http.NewRequestWithContext(ctx, "GET", rayURL+"/api/security/internal/targets?projectId="+url.QueryEscape(target.ProjectID), nil)
				if e != nil {
					return
				}
				freshReq.Header.Set("x-brain-secret", os.Getenv("BRAIN_INTERNAL_SECRET"))
				freshResp, e := (&http.Client{Timeout: 15 * time.Second}).Do(freshReq)
				if e != nil {
					log.Printf("[security] active target lookup failed: %v", e)
					return
				}
				var fresh struct {
					Targets []scanTarget `json:"targets"`
				}
				e = json.NewDecoder(io.LimitReader(freshResp.Body, 65536)).Decode(&fresh)
				freshResp.Body.Close()
				if e != nil || freshResp.StatusCode != 200 || len(fresh.Targets) != 1 || fresh.Targets[0].UserID != target.UserID || fresh.Targets[0].ProjectID != target.ProjectID {
					return
				}
				target = fresh.Targets[0]
				scanCtx, cancel := context.WithTimeout(ctx, 4*time.Minute)
				report, scanErr := security.ExecuteScan(scanCtx, security.ScanRequest{UserID: target.UserID, ProjectID: target.ProjectID, ProjectName: target.ProjectName, ProjectPath: target.ProjectPath, ContainerID: target.ContainerID, Trigger: "scheduled"})
				cancel()
				if scanErr != nil {
					report = &security.SecurityReport{ID: fmt.Sprintf("scan_%d", time.Now().UnixNano()), ProjectID: target.ProjectID, ProjectName: target.ProjectName, Trigger: "scheduled", Status: "error", Summary: "Scheduled scan incomplete", Logs: scanErr.Error(), CreatedAt: time.Now(), Findings: []security.FindingItem{}}
				}
				state.AttemptedAt = time.Now()
				state.Pending = report
				if err := atomicSecurityJSON(filename, state); err != nil {
					log.Printf("[security] cannot save scheduled report: %v", err)
					return
				}
			}
			report := *state.Pending
			deployReq := DeployRequest{UserID: target.UserID, ProjectID: target.ProjectID, Name: target.ProjectName}
			if err := persistSecurityReport(ctx, deployReq, &report); err != nil {
				state.NextDeliveryAt = time.Now().Add(15 * time.Minute)
				_ = atomicSecurityJSON(filename, state)
				log.Printf("[security] scheduled report delivery pending for %s: %v", target.ProjectID, err)
				return
			}
			state.Pending = nil
			if err := atomicSecurityJSON(filename, state); err != nil {
				log.Printf("[security] scheduled report state needs repair: %v", err)
			}
		}()
		if processed >= 5 {
			return
		}
	}
}

package deploy

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type hostJournal struct {
	Request    DeployRequest `json:"request"`
	Previous   *hostState    `json:"previous,omitempty"`
	WasRunning bool          `json:"wasRunning"`
	Completed  *hostState    `json:"completed,omitempty"`
}

func hostJournalPath(handle string) string {
	dir, _ := hostDir(handle)
	return filepath.Join(dir, "pending.json")
}

// Caller holds the lifecycle and per-runtime locks. Only verified process groups
// are signalled, including when recovery follows an interrupted replacement.
func restoreHostJournal(handle string, journal *hostJournal) (*hostState, error) {
	if journal.Completed != nil {
		if journal.Previous != nil {
			dir, _ := hostDir(handle)
			if err := atomicSecurityJSON(filepath.Join(dir, "previous.json"), journal.Previous); err != nil {
				return nil, err
			}
		}
		if err := writeHostState(journal.Completed); err != nil {
			return nil, err
		}
		return journal.Completed, os.Remove(hostJournalPath(handle))
	}
	current, err := readHostState(handle)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if current != nil && (journal.Previous == nil || current.Marker != journal.Previous.Marker) {
		if err := terminateHostGroup(current.PID, current.Marker); err != nil {
			return nil, err
		}
	}
	if err := removeRuntimeRoute(handle); err != nil {
		return nil, err
	}
	previous := journal.Previous
	if previous == nil {
		if current != nil {
			current.PID = 0
			current.Status = "failed"
			if err := writeHostState(current); err != nil {
				return nil, err
			}
		}
		return nil, os.Remove(hostJournalPath(handle))
	}
	if journal.WasRunning {
		if !hostProcessAlive(previous.PID, previous.Marker) {
			previous.PID = 0
			if err := startHost(previous); err != nil {
				return nil, fmt.Errorf("previous process could not restart: %w", err)
			}
			// Persist its new identity before health checks, making retries idempotent.
			if err := atomicSecurityJSON(hostJournalPath(handle), journal); err != nil {
				return nil, err
			}
		}
		ctx, cancel := context.WithTimeout(context.Background(), 310*time.Second)
		defer cancel()
		if err := hostHealth(ctx, previous); err != nil {
			return nil, err
		}
		if _, err := applyRouting(ctx, previous.Request, previous.Port, handle); err != nil {
			return nil, err
		}
		previous.Status = "healthy"
	} else {
		previous.Status = "stopped"
		previous.PID = 0
	}
	if err := writeHostState(previous); err != nil {
		return nil, err
	}
	_ = registerHostMonitor(previous)
	SaveDeploymentViaRayAPI(hostResult(previous), previous.Request)
	if previous.Status == "healthy" {
		watchHost(handle, previous.Marker)
	}
	return previous, os.Remove(hostJournalPath(handle))
}

func RecoverHostReplacement(handle string) error {
	dir, err := hostDir(handle)
	if err != nil {
		return err
	}
	control := controlFor(handle)
	control.mu.Lock()
	defer control.mu.Unlock()
	raw, err := os.ReadFile(filepath.Join(dir, "pending.json"))
	if err != nil {
		return err
	}
	var journal hostJournal
	if json.Unmarshal(raw, &journal) != nil || hostHandle(journal.Request) != handle {
		return fmt.Errorf("invalid host recovery journal")
	}
	state, err := restoreHostJournal(handle, &journal)
	if err == nil && state != nil && journal.Completed != nil {
		_ = registerHostMonitor(state)
		SaveDeploymentViaRayAPI(hostResult(state), state.Request)
		if state.Status == "healthy" {
			watchHost(handle, state.Marker)
		}
	}
	return err
}

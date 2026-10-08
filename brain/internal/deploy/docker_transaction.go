package deploy

import (
	"brain/server/internal/agent"
	"brain/server/internal/security"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"brain/server/internal/monitor"
)

type runtimeRelease struct {
	Request   DeployRequest `json:"request"`
	Result    DeployResult  `json:"result"`
	CreatedAt time.Time     `json:"createdAt"`
}
type dockerJournal struct {
	Completed    *runtimeRelease `json:"completed,omitempty"`
	Routes       []managedRoute  `json:"routes,omitempty"`
	Request      DeployRequest   `json:"request"`
	Name         string          `json:"name"`
	Image        string          `json:"image"`
	PreviousID   string          `json:"previousId"`
	PreviousName string          `json:"previousName"`
	WasRunning   bool            `json:"wasRunning"`
	Previous     *runtimeRelease `json:"previous,omitempty"`
}
type dockerIdentity struct {
	ID     string                 `json:"Id"`
	Name   string                 `json:"Name"`
	State  struct{ Running bool } `json:"State"`
	Config struct {
		Image  string
		Labels map[string]string
	} `json:"Config"`
}

func runtimeDir(name string) string {
	hash := sha256.Sum256([]byte(name))
	return filepath.Join(lifecycleRoot(), "runtimes", hex.EncodeToString(hash[:]))
}
func dockerInspect(ctx context.Context, name string) (*dockerIdentity, error) {
	raw, err := dockerCmd(ctx, "inspect", "--type", "container", "--", name).Output()
	if err != nil {
		return nil, err
	}
	var rows []dockerIdentity
	if json.Unmarshal(raw, &rows) != nil || len(rows) != 1 {
		return nil, fmt.Errorf("invalid Docker inspection")
	}
	return &rows[0], nil
}
func readActiveRelease(name string) (*runtimeRelease, error) {
	raw, err := os.ReadFile(filepath.Join(runtimeDir(name), "active.json"))
	if err != nil {
		return nil, err
	}
	var value runtimeRelease
	err = json.Unmarshal(raw, &value)
	return &value, err
}
func beginDockerReplacement(ctx context.Context, req DeployRequest, name, image string) (*dockerJournal, error) {
	if _, err := os.Stat(filepath.Join(runtimeDir(name), "pending.json")); !os.IsNotExist(err) {
		return nil, fmt.Errorf("an interrupted replacement requires recovery before deploying again")
	}
	j := &dockerJournal{Request: req, Name: name, Image: image}
	routes, routeErr := readRoutes()
	if routeErr != nil {
		return nil, routeErr
	}
	for _, route := range routes {
		if route.Runtime == name {
			j.Routes = append(j.Routes, route)
		}
	}
	// Listing distinguishes a missing container from a failed Docker daemon request.
	raw, err := dockerCmd(ctx, "ps", "-a", "--filter", "name=^/"+name+"$", "--format", "{{.ID}}").Output()
	if err != nil {
		return nil, fmt.Errorf("cannot inspect previous container")
	}
	if strings.TrimSpace(string(raw)) != "" {
		old, err := dockerInspect(ctx, name)
		if err != nil {
			return nil, err
		}
		if project := old.Config.Labels["io.ray.project"]; project != "" && project != securityIdentity(req) {
			return nil, fmt.Errorf("container belongs to another project")
		}
		j.PreviousID = old.ID
		j.WasRunning = old.State.Running
		j.PreviousName = name + "-previous-" + fmt.Sprint(time.Now().UnixNano())
		if owner := old.Config.Labels["io.ray.owner"]; owner != "" && owner != req.UserID {
			return nil, fmt.Errorf("container name belongs to another owner")
		}
		previous, readErr := readActiveRelease(name)
		if readErr != nil && !os.IsNotExist(readErr) {
			return nil, readErr
		}
		if previous != nil {
			if previous.Request.UserID != req.UserID || securityIdentity(previous.Request) != securityIdentity(req) {
				return nil, fmt.Errorf("runtime owner mismatch")
			}
			if !sameContainerID(previous.Result.ContainerID, old.ID) || previous.Result.ImageName != old.Config.Image {
				return nil, fmt.Errorf("saved runtime differs from the current container; reconcile its state before replacement")
			}
			j.Previous = previous
		}
	}
	if err := atomicSecurityJSON(filepath.Join(runtimeDir(name), "pending.json"), j); err != nil {
		return nil, err
	}
	return j, nil
}
func (j *dockerJournal) stopPrevious(ctx context.Context) error {
	if j.PreviousID == "" {
		return nil
	}
	if _, err := dockerCmd(ctx, "stop", "--time", "20", j.PreviousID).CombinedOutput(); err != nil {
		return fmt.Errorf("could not stop previous container")
	}
	if _, err := dockerCmd(ctx, "rename", j.PreviousID, j.PreviousName).CombinedOutput(); err != nil {
		return fmt.Errorf("could not retain previous container")
	}
	return nil
}
func (j *dockerJournal) restore(ctx context.Context) error {
	current, err := dockerInspect(ctx, j.Name)
	if err != nil {
		raw, listErr := dockerCmd(ctx, "ps", "-a", "--filter", "name=^/"+j.Name+"$", "--format", "{{.ID}}").Output()
		if listErr != nil || strings.TrimSpace(string(raw)) != "" {
			return fmt.Errorf("cannot verify replacement container; recovery journal preserved")
		}
	}
	if err == nil && current.ID != j.PreviousID {
		if current.Config.Image != j.Image || current.Config.Labels["io.ray.owner"] != j.Request.UserID {
			return fmt.Errorf("refusing to replace an unexpected container during recovery")
		}
		if _, err := dockerCmd(ctx, "rm", "-f", current.ID).CombinedOutput(); err != nil {
			return fmt.Errorf("could not stop failed replacement")
		}
	}
	if err := removeRuntimeRoute(j.Name); err != nil {
		return err
	}
	if j.PreviousID != "" {
		previous, err := dockerInspect(ctx, j.PreviousID)
		if err != nil {
			return fmt.Errorf("previous container is unavailable; retained journal needs operator recovery")
		}
		if strings.TrimPrefix(previous.Name, "/") != j.Name {
			if _, err := dockerCmd(ctx, "rename", j.PreviousID, j.Name).CombinedOutput(); err != nil {
				return fmt.Errorf("could not restore previous container name")
			}
		}
		if j.WasRunning {
			if _, err := dockerCmd(ctx, "start", j.PreviousID).CombinedOutput(); err != nil {
				return fmt.Errorf("could not restart previous container")
			}
		}
		if j.Previous != nil && j.WasRunning {
			old := j.Previous
			host, _ := routingHost(old.Request)
			if err := waitForHealth(ctx, old.Result.HostPort, old.Request.HealthCheck, nil, host); err != nil {
				return fmt.Errorf("previous container restarted but failed health check: %w", err)
			}
			if _, err := applyRouting(ctx, old.Request, old.Result.HostPort, j.Name); err != nil {
				return fmt.Errorf("previous container restored but routing recovery failed: %w", err)
			}
			_ = monitor.AddContainerProject(old.Request.UserID, old.Request.Name, old.Request.ProjectPath, j.Name, 30, old.Request.ProjectID)
			SaveDeploymentViaRayAPI(&old.Result, old.Request)
		}
	}
	if j.Previous != nil {
		if err := atomicSecurityJSON(filepath.Join(runtimeDir(j.Name), "active.json"), j.Previous); err != nil {
			return err
		}
	}
	if j.WasRunning && j.Previous == nil {
		for _, r := range j.Routes {
			if _, err := applyRouting(ctx, DeployRequest{UserID: r.Owner, ProjectID: r.Project, RoutingMode: "https", ProjectURL: "https://" + r.Host}, r.Port, j.Name); err != nil {
				return err
			}
		}
	}

	return os.Remove(filepath.Join(runtimeDir(j.Name), "pending.json"))
}
func (j *dockerJournal) commit(result *DeployResult) error {
	j.Completed = &runtimeRelease{Request: j.Request, Result: *result, CreatedAt: time.Now()}
	if err := atomicSecurityJSON(filepath.Join(runtimeDir(j.Name), "pending.json"), j); err != nil {
		j.Completed = nil
		return err
	}
	// The durable commit record is authoritative if indexing is interrupted.
	if err := j.finishCommit(); err != nil {
		fmt.Printf("[deploy] committed release needs index recovery: %v\n", err)
	}
	return nil
}
func (j *dockerJournal) finishCommit() error {
	if j.Previous != nil {
		if err := atomicSecurityJSON(filepath.Join(runtimeDir(j.Name), "previous.json"), j.Previous); err != nil {
			return err
		}
	}
	if err := atomicSecurityJSON(filepath.Join(runtimeDir(j.Name), "active.json"), j.Completed); err != nil {
		return err
	}
	return os.Remove(filepath.Join(runtimeDir(j.Name), "pending.json"))
}

// Recovery is explicit and uses the same operation lock as deployment. A journal
// prevents a new deployment from overwriting the only recoverable container.
func RecoverDockerReplacement(name string) error {
	raw, err := os.ReadFile(filepath.Join(runtimeDir(name), "pending.json"))
	if err != nil {
		return err
	}
	var journal dockerJournal
	if json.Unmarshal(raw, &journal) != nil || journal.Name != name {
		return fmt.Errorf("invalid recovery journal")
	}
	if journal.Completed != nil {
		if err := journal.finishCommit(); err != nil {
			return err
		}
		SaveDeploymentViaRayAPI(&journal.Completed.Result, journal.Completed.Request)
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()
	return journal.restore(ctx)
}

func RollbackRuntime(name, deploymentID string) (*DeployResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	if strings.HasPrefix(name, hostPrefix) {
		dir, err := hostDir(name)
		if err != nil {
			return nil, err
		}
		raw, err := os.ReadFile(filepath.Join(dir, "previous.json"))
		if err != nil {
			return nil, fmt.Errorf("no previous host release is retained")
		}
		var previous hostState
		if json.Unmarshal(raw, &previous) != nil || previous.Handle != name {
			return nil, fmt.Errorf("invalid previous host release")
		}
		req := previous.Request
		req.ID = deploymentID
		req.SecurityOverride = ""
		req.sourcePrepared = true
		baseline, err := runSecurityGate(ctx, req, func(DeployStepEvent) {})
		if err != nil {
			return nil, err
		}
		req.skipBuild = true
		result, err := executeHostDeployment(ctx, req, func(DeployStepEvent) {})
		if err == nil && baseline != nil {
			_ = atomicSecurityJSON(filepath.Join(securityDir(req), "baseline.json"), baseline)
		}
		return result, err
	}
	if _, err := os.Stat(filepath.Join(runtimeDir(name), "pending.json")); err == nil {
		return nil, fmt.Errorf("recover the interrupted replacement before requesting rollback")
	}
	raw, err := os.ReadFile(filepath.Join(runtimeDir(name), "previous.json"))
	if err != nil {
		return nil, fmt.Errorf("no previous Docker release is retained")
	}
	var previous runtimeRelease
	if json.Unmarshal(raw, &previous) != nil || previous.Result.ContainerName != name {
		return nil, fmt.Errorf("invalid previous release")
	}
	if _, err := dockerInspect(ctx, previous.Result.ContainerID); err != nil {
		return nil, fmt.Errorf("previous container is no longer available")
	}
	req := previous.Request
	req.ID = deploymentID
	req.SecurityOverride = ""
	baseline, err := runSecurityGate(ctx, req, func(DeployStepEvent) {})
	if err != nil {
		return nil, err
	}
	policy := security.AdvancedConfig{}
	if agent.IsSecurityChecksEnabled() {
		var policyErr error
		policy, policyErr = security.LoadAdvancedConfig()
		if policyErr != nil {
			return nil, policyErr
		}
	}
	if policy.Images {
		report := &security.SecurityReport{ID: fmt.Sprintf("scan_%d", time.Now().UnixNano()), ProjectID: securityIdentity(req), ProjectName: req.Name, Trigger: "image_gate", Status: "passed", CreatedAt: time.Now(), Findings: []security.FindingItem{}}
		scanErr := security.ScanContainer(ctx, req.UserID, securityIdentity(req), previous.Result.ContainerID, report)
		if scanErr != nil {
			report.Status = "error"
			report.Logs = scanErr.Error()
			report.Summary = "Rollback image scan incomplete"
		}
		if err := persistSecurityReport(ctx, req, report); err != nil {
			return nil, err
		}
		if report.Status == "danger" || report.Status == "error" {
			return nil, fmt.Errorf("rollback image blocked by scan %s", report.ID)
		}
	}
	journal, err := beginDockerReplacement(ctx, req, name, previous.Result.ImageName)
	if err != nil {
		return nil, err
	}
	restore := func(cause error) (*DeployResult, error) {
		recoveryCtx, recoveryCancel := context.WithTimeout(context.Background(), 6*time.Minute)
		defer recoveryCancel()
		if e := journal.restore(recoveryCtx); e != nil {
			return nil, fmt.Errorf("rollback failed: %v; restoration incomplete: %w", cause, e)
		}
		return nil, fmt.Errorf("rollback failed; original release restored: %w", cause)
	}
	if err = journal.stopPrevious(ctx); err != nil {
		return restore(err)
	}
	if _, err = dockerCmd(ctx, "rename", previous.Result.ContainerID, name).CombinedOutput(); err != nil {
		return restore(err)
	}
	if _, err = dockerCmd(ctx, "start", previous.Result.ContainerID).CombinedOutput(); err != nil {
		return restore(err)
	}
	host, _ := routingHost(req)
	if err = waitForHealth(ctx, previous.Result.HostPort, req.HealthCheck, nil, host); err != nil {
		return restore(err)
	}
	if _, err = applyRouting(ctx, req, previous.Result.HostPort, name); err != nil {
		return restore(err)
	}
	result := previous.Result
	result.DeploymentID = deploymentID
	result.Status = "healthy"
	result.BuildLogs = "[ROLLBACK] Previous retained image restored without rebuilding."
	if err = journal.commit(&result); err != nil {
		return restore(err)
	}
	if baseline != nil {
		_ = atomicSecurityJSON(filepath.Join(securityDir(req), "baseline.json"), baseline)
	}
	_ = monitor.AddContainerProject(req.UserID, req.Name, req.ProjectPath, name, 30, req.ProjectID)
	SaveDeploymentViaRayAPI(&result, req)
	return &result, nil
}

// Project-facing recovery uses saved ownership rather than trusting a container
// name alone; names can be reused after external or older deployments.
func ValidateRecoveryOwner(name, owner, project string) error {
	if owner == "" || project == "" {
		return fmt.Errorf("owner and project required for recovery")
	}
	var filename string
	if strings.HasPrefix(name, hostPrefix) {
		expected := hostHandle(DeployRequest{UserID: owner, ProjectID: project})
		if name != expected {
			return fmt.Errorf("host runtime does not belong to this project")
		}
		return nil
	}
	filename = filepath.Join(runtimeDir(name), "pending.json")
	raw, err := os.ReadFile(filename)
	if os.IsNotExist(err) {
		release, readErr := readActiveRelease(name)
		if readErr != nil {
			return fmt.Errorf("no owned runtime manifest is available")
		}
		if release.Request.UserID != owner || securityIdentity(release.Request) != project {
			return fmt.Errorf("runtime ownership mismatch")
		}
		return nil
	}
	if err != nil {
		return err
	}
	var journal dockerJournal
	if json.Unmarshal(raw, &journal) != nil || journal.Name != name || journal.Request.UserID != owner || securityIdentity(journal.Request) != project {
		return fmt.Errorf("recovery journal ownership mismatch")
	}
	return nil
}

// Older deployment records used Docker's 12-character display ID.
func sameContainerID(saved, actual string) bool {
	return saved == actual || (len(saved) >= 12 && strings.HasPrefix(actual, saved))
}

package deploy

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"brain/server/internal/agent"
	"brain/server/internal/security"
)

var deploymentLocks sync.Map
var activeDeploymentIDs sync.Map
var activeDeploymentRuntimes sync.Map

func CancelDeployment(userID, id string) bool {
	if id == "" || userID == "" {
		return false
	}
	cancel, ok := activeDeploymentIDs.Load(userID + "\x00" + id)
	if ok {
		cancel.(context.CancelFunc)()
	}
	return ok
}
func cancelActiveRuntime(runtime string) {
	if cancel, ok := activeDeploymentRuntimes.Load(runtime); ok {
		cancel.(context.CancelFunc)()
	}
}

func securityIdentity(req DeployRequest) string {
	if req.ProjectID != "" {
		return req.ProjectID
	}
	if req.ID != "" {
		return req.ID
	}
	return req.Name
}
func securityDir(req DeployRequest) string {
	root := os.Getenv("RAY_SECURITY_DIR")
	if root == "" {
		home, _ := os.UserHomeDir()
		root = filepath.Join(home, ".ray", "security")
	}
	digest := sha256.Sum256([]byte(req.UserID + "\x00" + securityIdentity(req)))
	return filepath.Join(root, hex.EncodeToString(digest[:]))
}
func atomicSecurityJSON(filename string, data any) error {
	if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
		return err
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(filename), ".security-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, err = file.Write(raw)
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), filename)
}
func loadSecurityBaseline(req DeployRequest) *security.Baseline {
	var baseline security.Baseline
	data, err := os.ReadFile(filepath.Join(securityDir(req), "baseline.json"))
	if err != nil || json.Unmarshal(data, &baseline) != nil {
		return nil
	}
	return &baseline
}
func overrideValid(token string, req DeployRequest, report *security.SecurityReport) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return false
	}
	secret := os.Getenv("BRAIN_INTERNAL_SECRET")
	if secret == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("ray-security-override:v1:" + parts[0]))
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(sig, mac.Sum(nil)) {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	var claims struct {
		User    string `json:"user"`
		Project string `json:"project"`
		Tree    string `json:"tree"`
		Rules   string `json:"rules"`
		Expires int64  `json:"expires"`
	}
	if json.Unmarshal(raw, &claims) != nil {
		return false
	}
	return claims.User == req.UserID && claims.Project == securityIdentity(req) && claims.Tree == report.TreeDigest && claims.Rules == report.RulesVersion && claims.Expires > time.Now().Unix() && claims.Expires <= time.Now().Add(11*time.Minute).Unix()
}
func persistSecurityReport(ctx context.Context, req DeployRequest, report *security.SecurityReport) error {
	metadata, _ := json.Marshal(map[string]any{"deploymentId": req.ID, "projectId": securityIdentity(req), "tree": report.TreeDigest, "rules": report.RulesVersion, "mode": report.Mode, "filesScanned": report.FilesScanned, "filesReused": report.FilesReused, "excluded": report.ExcludedFiles})
	report.Logs = "[SECURITY_GATE] " + string(metadata) + "\n" + report.Logs
	if err := atomicSecurityJSON(filepath.Join(securityDir(req), "reports", report.ID+".json"), report); err != nil {
		return fmt.Errorf("could not save local security report")
	}
	rayURL := os.Getenv("RAY_URL")
	if rayURL == "" {
		rayURL = "http://localhost:3000"
	}
	secret := os.Getenv("BRAIN_INTERNAL_SECRET")
	if secret == "" {
		return fmt.Errorf("security report persistence requires Brain's internal authentication secret")
	}
	body, _ := json.Marshal(map[string]any{"userId": req.UserID, "report": report})
	request, err := http.NewRequestWithContext(ctx, "POST", rayURL+"/api/security/internal/report", bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-brain-secret", secret)
	response, err := (&http.Client{Timeout: 10 * time.Second}).Do(request)
	if err != nil {
		return fmt.Errorf("security report could not be saved in Ray; deployment blocked")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return fmt.Errorf("security report persistence rejected; deployment blocked")
	}
	return nil
}

// ExecuteDeployment is the only managed build entry point. Neither clients nor
// AI tools can disable its gate through a request field. Policy comes from settings.
func ExecuteDeployment(ctx context.Context, req DeployRequest, emit func(DeployStepEvent)) (*DeployResult, error) {
	if req.UserID == "" || req.Name == "" {
		return nil, fmt.Errorf("deployment requires an owner and name")
	}
	releaseOperation, operationErr := AcquireOperation()
	if operationErr != nil {
		return nil, operationErr
	}
	defer releaseOperation()
	if err := checkProjectNotDeleted(req); err != nil {
		return nil, err
	}
	var validationErr error
	req.HealthCheck, validationErr = normalizeHealth(req.HealthCheck)
	if validationErr != nil {
		return nil, validationErr
	}
	if err := preflightRouting(ctx, req); err != nil {
		return nil, err
	}
	key := req.UserID + "\x00" + securityIdentity(req)
	value, _ := deploymentLocks.LoadOrStore(key, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	if !lock.TryLock() {
		return nil, fmt.Errorf("another managed deployment is running for this project")
	}
	defer lock.Unlock()
	ctx, cancelDeployment := context.WithCancel(ctx)
	defer cancelDeployment()
	runtimeKey := SanitizeContainerName(req.Name)
	if req.DockerEnabled != nil && !*req.DockerEnabled {
		runtimeKey = hostHandle(req)
	}
	activeDeploymentRuntimes.Store(runtimeKey, cancelDeployment)
	defer activeDeploymentRuntimes.Delete(runtimeKey)
	if req.ID != "" {
		activeDeploymentIDs.Store(req.UserID+"\x00"+req.ID, cancelDeployment)
		defer activeDeploymentIDs.Delete(req.UserID + "\x00" + req.ID)
	}

	if req.RepoURL != "" || req.SourceType == "github" {
		return nil, fmt.Errorf("prepare Git source through Ray before deployment; in-place Git updates are not allowed")
	}
	source := req.ProjectPath
	if !filepath.IsAbs(source) {
		source = filepath.Join(agent.GetDeploymentsDir(), source)
	}
	resolved, err := filepath.EvalSymlinks(source)
	if err != nil {
		return nil, fmt.Errorf("deployment source is unavailable")
	}
	emit(DeployStepEvent{Step: "security", Status: "running", Message: "Preparing isolated source for security checks"})
	identity := req
	identity.ProjectID = securityIdentity(req)
	staged, err := stageSourceAt(ctx, resolved, hostHandle(identity), agent.GetDeploymentsDir(), ".security-releases")
	if err != nil {
		return nil, fmt.Errorf("prepare security source: %w", err)
	}
	req.SourceReference = resolved
	req.ProjectPath = staged
	req.sourcePrepared = true
	req.GitHubToken = ""
	if err := recordArtifact(req, nil, "building"); err != nil {
		return nil, err
	}
	finished := false
	defer func() {
		if !finished {
			_ = recordArtifact(req, nil, "failed")
		}
	}()
	baseline, err := runSecurityGate(ctx, req, emit)
	if err != nil {
		return nil, err
	}
	var completed *DeployStepEvent
	result, err := executeDeployment(ctx, req, func(event DeployStepEvent) {
		if event.Step == StepComplete {
			event.ProjectPath = req.ProjectPath
			completed = &event
			return
		}
		emit(event)
	})
	if err != nil {
		return nil, err
	}
	if baseline != nil {
		if saveErr := atomicSecurityJSON(filepath.Join(securityDir(req), "baseline.json"), baseline); saveErr != nil {
			emit(DeployStepEvent{Step: StepMonitor, Status: "running", Message: "Application started, but security baseline could not be saved; the next release will be fully scanned."})
		}
	}
	if err := recordArtifact(req, result, "healthy"); err != nil {
		emit(DeployStepEvent{Step: StepMonitor, Status: "running", Message: "Release is healthy; retention tracking needs repair: " + err.Error()})
	}
	finished = true
	if completed != nil {
		emit(*completed)
	}
	return result, nil
}

func runSecurityGate(ctx context.Context, req DeployRequest, emit func(DeployStepEvent)) (*security.Baseline, error) {
	scanCtx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	var err error
	var report *security.SecurityReport
	var baseline *security.Baseline
	if agent.IsSecurityChecksEnabled() {
		before, fingerprintErr := security.SourceFingerprint(scanCtx, req.ProjectPath)
		if fingerprintErr != nil {
			err = fingerprintErr
		} else {
			report, baseline, err = security.Analyze(scanCtx, security.ScanRequest{ProjectID: securityIdentity(req), ProjectName: req.Name, ProjectPath: req.ProjectPath, Trigger: "deployment_gate"}, loadSecurityBaseline(req))
			if err == nil {
				err = security.ScanDependencies(scanCtx, req.ProjectPath, report)
			}
			if err == nil {
				after, fingerprintErr := security.SourceFingerprint(scanCtx, req.ProjectPath)
				if fingerprintErr != nil || before != after {
					err = fmt.Errorf("source changed during security scan")
				} else {
					settings, _ := json.Marshal(struct {
						Health                  HealthCheck
						RoutingMode, ProjectURL string
						Docker                  *bool
						Framework, Build, Start string
						Env                     map[string]string
						HostPort, ContainerPort int
					}{req.HealthCheck, req.RoutingMode, req.ProjectURL, req.DockerEnabled, req.Framework, req.BuildCommand, req.StartCommand, req.EnvVars, req.HostPort, req.ContainerPort})
					digest := sha256.Sum256(append([]byte(after+"\x00"), settings...))
					report.TreeDigest = hex.EncodeToString(digest[:])
				}
			}
		}
		if err != nil {
			report = &security.SecurityReport{ID: fmt.Sprintf("scan_%d", time.Now().UnixNano()), ProjectID: securityIdentity(req), ProjectName: req.Name, Trigger: "deployment_gate", Status: "error", Summary: "Security scan did not complete; deployment blocked.", Logs: err.Error(), CreatedAt: time.Now(), Findings: []security.FindingItem{}}
		}
	} else {
		report = &security.SecurityReport{ID: fmt.Sprintf("scan_%d", time.Now().UnixNano()), ProjectID: securityIdentity(req), ProjectName: req.Name, Trigger: "deployment_gate", Status: "skipped", Summary: "Security gate disabled in server settings; source was not scanned.", Logs: "Security checks disabled by server policy.", CreatedAt: time.Now(), Findings: []security.FindingItem{}}
	}
	report.DeploymentID = req.ID
	if report.Status == "danger" {
		report.Overridden = overrideValid(req.SecurityOverride, req, report)
	}
	if persistErr := persistSecurityReport(ctx, req, report); persistErr != nil {
		emit(DeployStepEvent{Step: "security", Status: "error", SecurityStatus: "error", ScanID: report.ID, Message: persistErr.Error()})
		return nil, persistErr
	}
	status := "success"
	if report.Status == "error" || (report.Status == "danger" && !report.Overridden) {
		status = "error"
	}
	emit(DeployStepEvent{Step: "security", Status: status, SecurityStatus: report.Status, SecurityOverridden: report.Overridden, ScanID: report.ID, Message: report.Summary})
	if status == "error" {
		return nil, fmt.Errorf("security gate blocked deployment; review scan %s", report.ID)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return baseline, nil
}

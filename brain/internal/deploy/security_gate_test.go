package deploy

import (
	"brain/server/internal/agent"
	"brain/server/internal/security"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSecurityApprovalBinding(t *testing.T) {
	t.Setenv("BRAIN_INTERNAL_SECRET", "test-secret")
	req := DeployRequest{UserID: "owner", ProjectID: "project"}
	report := &security.SecurityReport{TreeDigest: "tree", RulesVersion: "rules"}
	sign := func(owner, project, tree, rules string, expires int64) string {
		raw, _ := json.Marshal(map[string]any{"user": owner, "project": project, "tree": tree, "rules": rules, "expires": expires})
		payload := base64.RawURLEncoding.EncodeToString(raw)
		mac := hmac.New(sha256.New, []byte("test-secret"))
		mac.Write([]byte("ray-security-override:v1:" + payload))
		return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	}
	valid := time.Now().Add(10 * time.Minute).Unix()
	if !overrideValid(sign("owner", "project", "tree", "rules", valid), req, report) {
		t.Fatal("valid approval rejected")
	}
	for _, token := range []string{sign("other", "project", "tree", "rules", valid), sign("owner", "other", "tree", "rules", valid), sign("owner", "project", "changed", "rules", valid), sign("owner", "project", "tree", "changed", valid), sign("owner", "project", "tree", "rules", time.Now().Add(-time.Minute).Unix()), sign("owner", "project", "tree", "rules", time.Now().Add(time.Hour).Unix()), "invalid.signature"} {
		if overrideValid(token, req, report) {
			t.Fatal("unbound approval accepted")
		}
	}
}
func TestCancelDeploymentOwnerBoundary(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	activeDeploymentIDs.Store("owner\x00id", cancel)
	defer activeDeploymentIDs.Delete("owner\x00id")
	if CancelDeployment("other", "id") || ctx.Err() != nil {
		t.Fatal("cross-owner cancel")
	}
	if !CancelDeployment("owner", "id") || ctx.Err() == nil {
		t.Fatal("cancel not delivered")
	}
}
func TestReportPersistenceFailure(t *testing.T) {
	t.Setenv("RAY_SECURITY_DIR", t.TempDir())
	t.Setenv("BRAIN_INTERNAL_SECRET", "")
	req := DeployRequest{UserID: "owner", ProjectID: "project"}
	r := &security.SecurityReport{ID: "scan_123", Status: "passed"}
	if err := persistSecurityReport(context.Background(), req, r); err == nil {
		t.Fatal("missing authenticated persistence accepted")
	}
	if _, err := os.Stat(filepath.Join(securityDir(req), "reports", "scan_123.json")); err != nil {
		t.Fatal("local diagnostic report missing")
	}
}

type gateTransport func(*http.Request) (*http.Response, error)

func (f gateTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestManagedGateBlocksBeforeBuild(t *testing.T) {
	t.Setenv("PUTMEIN_CONFIG_PATH", filepath.Join(t.TempDir(), "settings.json"))
	previous := agent.IsSecurityChecksEnabled()
	agent.SetSecurityChecksEnabled(true)
	defer agent.SetSecurityChecksEnabled(previous)
	t.Setenv("RAY_SECURITY_DIR", t.TempDir())
	t.Setenv("BRAIN_INTERNAL_SECRET", "test")
	transport := http.DefaultTransport
	defer func() { http.DefaultTransport = transport }()
	http.DefaultTransport = gateTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"ok":true}`)), Header: make(http.Header)}, nil
	})
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "main.py"), []byte("key = 'AKIA"+strings.Repeat("A", 16)+"'"), 0600); err != nil {
		t.Fatal(err)
	}
	req := DeployRequest{UserID: "owner", ProjectID: "project", Name: "fixture", ProjectPath: root}
	var final DeployStepEvent
	baseline, err := runSecurityGate(context.Background(), req, func(e DeployStepEvent) { final = e })
	if err == nil || baseline != nil || final.SecurityStatus != "danger" || final.Status != "error" {
		t.Fatalf("gate accepted dangerous source: %v %+v", err, final)
	}
	if loadSecurityBaseline(req) != nil {
		t.Fatal("blocked gate committed a baseline")
	}
	if err := os.WriteFile(filepath.Join(root, "main.py"), []byte("print('ok')"), 0600); err != nil {
		t.Fatal(err)
	}
	http.DefaultTransport = gateTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 500, Body: io.NopCloser(strings.NewReader("failed")), Header: make(http.Header)}, nil
	})
	if _, err := runSecurityGate(context.Background(), req, func(DeployStepEvent) {}); err == nil {
		t.Fatal("persistence failure bypassed gate")
	}
}

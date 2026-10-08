package security

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func prepareScannerFixture(t *testing.T, output string) {
	t.Helper()
	root := t.TempDir()
	t.Setenv("RAY_ADVANCED_SECURITY_DIR", root)
	dir := filepath.Join(root, "trivy-cache", "db")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"UpdatedAt": time.Now().UTC()})
	if err := os.WriteFile(filepath.Join(dir, "metadata.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	bin := t.TempDir()
	script := "#!/bin/sh\nif [ -n \"$TRIVY_SKIP_FILES\" ]; then exit 9; fi\nprintf '%s' '" + output + "'\n"
	if err := os.WriteFile(filepath.Join(bin, "trivy"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
}
func TestTrivySeverityAndIdentity(t *testing.T) {
	raw := []byte(`{"SchemaVersion":2,"Results":[{"Target":"package-lock.json","Vulnerabilities":[{"VulnerabilityID":"CVE-fixture","PkgName":"example","InstalledVersion":"1.0","FixedVersion":"2.0","Severity":"HIGH"}]}]}`)
	first, err := scannerFindings(raw)
	if err != nil {
		t.Fatal(err)
	}
	second, _ := scannerFindings(raw)
	if len(first) != 1 || first[0].Severity != SeverityDanger || first[0].ID != second[0].ID {
		t.Fatal(first)
	}
	if _, err := scannerFindings([]byte(`{"SchemaVersion":999}`)); err == nil {
		t.Fatal("unknown schema accepted")
	}
	report := &SecurityReport{Status: "passed", RulesVersion: "source"}
	appendExternal(report, first, "dependencies")
	if report.Status != "danger" || report.DangerCount != 1 || report.RulesVersion == "source" {
		t.Fatal(report)
	}
}
func TestDependencyScanAndSymlinkBoundary(t *testing.T) {
	prepareScannerFixture(t, `{"SchemaVersion":2,"Results":[{"Target":"package-lock.json","Vulnerabilities":[]}]}`)
	t.Setenv("TRIVY_SKIP_FILES", "*")
	if err := SaveAdvancedConfig(AdvancedConfig{Dependencies: true}); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package-lock.json"), []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	report := &SecurityReport{Status: "passed"}
	if err := ScanDependencies(context.Background(), root, report); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(report.Logs, "Dependency manifest scan") {
		t.Fatal("missing coverage")
	}
	outside := filepath.Join(t.TempDir(), "secret")
	os.WriteFile(outside, []byte("private"), 0600)
	if err := os.Symlink(outside, filepath.Join(root, "yarn.lock")); err != nil {
		t.Fatal(err)
	}
	if err := ScanDependencies(context.Background(), root, report); err == nil {
		t.Fatal("symlink manifest accepted")
	}
}
func TestAdvancedPolicyAndStaleDatabase(t *testing.T) {
	prepareScannerFixture(t, `{"SchemaVersion":2,"Results":[]}`)
	if err := SaveAdvancedConfig(AdvancedConfig{RescanHours: 1}); err == nil {
		t.Fatal("short interval accepted")
	}
	file := filepath.Join(AdvancedRoot(), "trivy-cache", "db", "metadata.json")
	raw, _ := json.Marshal(map[string]any{"UpdatedAt": time.Now().Add(-72 * time.Hour)})
	if err := os.WriteFile(file, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err := ValidateAdvisoryCache(); err == nil {
		t.Fatal("stale database accepted")
	}
	if err := SaveAdvancedConfig(AdvancedConfig{Images: true}); err == nil {
		t.Fatal("enabled stale scanner")
	}
	if err := SaveAdvancedConfig(AdvancedConfig{RescanHours: 24}); err != nil {
		t.Fatal(err)
	}
}

func TestTrivyIncompleteOutput(t *testing.T) {
	for _, raw := range []string{`{`, `{"SchemaVersion":2,"Results":[]}`, `{"SchemaVersion":2,"Results":[{"Target":"lock","Vulnerabilities":[{"VulnerabilityID":"CVE-fixture","PkgName":"example","Severity":"UNRECOGNIZED"}]}]}`} {
		if _, err := scannerFindings([]byte(raw)); err == nil {
			t.Fatalf("incomplete output accepted: %s", raw)
		}
	}
}

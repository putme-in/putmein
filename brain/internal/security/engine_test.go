package security

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeSource(t *testing.T, root, name, value string) {
	t.Helper()
	p := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(value), 0600); err != nil {
		t.Fatal(err)
	}
}
func TestIncrementalSecurity(t *testing.T) {
	root := t.TempDir()
	req := ScanRequest{ProjectPath: root, ProjectName: "fixture"}
	writeSource(t, root, "main.py", "print('ready')")
	first, base, err := Analyze(context.Background(), req, nil)
	if err != nil || first.Status != "passed" {
		t.Fatalf("initial: %v %+v", err, first)
	}
	secret := "AKIA" + strings.Repeat("A", 16)
	writeSource(t, root, "main.py", "key = '"+secret+"'")
	changed, base, err := Analyze(context.Background(), req, base)
	if err != nil || changed.DangerCount == 0 || changed.FilesScanned != 1 {
		t.Fatalf("change: %v %+v", err, changed)
	}
	raw, _ := json.Marshal(changed)
	if strings.Contains(string(raw), secret) {
		t.Fatal("secret leaked into report")
	}
	unchanged, base, err := Analyze(context.Background(), req, base)
	if err != nil || unchanged.DangerCount == 0 || unchanged.FilesReused != 1 {
		t.Fatalf("unchanged: %v %+v", err, unchanged)
	}
	if err := os.Remove(filepath.Join(root, "main.py")); err != nil {
		t.Fatal(err)
	}
	deleted, _, err := Analyze(context.Background(), req, base)
	if err != nil || deleted.DangerCount != 0 {
		t.Fatalf("deleted: %v %+v", err, deleted)
	}
	writeSource(t, root, "main.py", "print('ready')")
	base.RulesVersion = "old"
	renewed, _, err := Analyze(context.Background(), req, base)
	if err != nil || renewed.Mode != "full" {
		t.Fatalf("rules refresh: %v %+v", err, renewed)
	}
}
func TestSecurityFailsClosed(t *testing.T) {
	t.Run("escape", func(t *testing.T) {
		root := t.TempDir()
		outside := t.TempDir()
		writeSource(t, outside, "secret.py", "pass")
		if err := os.Symlink(filepath.Join(outside, "secret.py"), filepath.Join(root, "link.py")); err != nil {
			t.Fatal(err)
		}
		if _, _, err := Analyze(context.Background(), ScanRequest{ProjectPath: root}, nil); err == nil {
			t.Fatal("escaping symlink accepted")
		}
	})
	t.Run("cancel", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, _, err := Analyze(ctx, ScanRequest{ProjectPath: t.TempDir()}, nil); err == nil {
			t.Fatal("cancellation ignored")
		}
	})
	t.Run("size", func(t *testing.T) {
		root := t.TempDir()
		writeSource(t, root, "huge.py", strings.Repeat("a", 8*1024*1024+1))
		if _, _, err := Analyze(context.Background(), ScanRequest{ProjectPath: root}, nil); err == nil {
			t.Fatal("size limit ignored")
		}
	})
}
func TestSnapshotCoversExcludedFiles(t *testing.T) {
	root := t.TempDir()
	writeSource(t, root, "node_modules/pkg/index.js", "first")
	a, err := SourceFingerprint(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	writeSource(t, root, "node_modules/pkg/index.js", "second")
	b, err := SourceFingerprint(context.Background(), root)
	if err != nil || a == b {
		t.Fatal("excluded dependency change must invalidate approval")
	}
}
func TestNextAdvisoryBoundaries(t *testing.T) {
	for _, tc := range []struct {
		version string
		danger  bool
	}{{"14.2.24", true}, {"14.2.25", false}, {"15.2.2", true}, {"15.2.3", false}, {"13.5.8", true}, {"13.5.9", true}, {"12.3.4", true}, {"12.3.5", false}} {
		t.Run(tc.version, func(t *testing.T) {
			root := t.TempDir()
			writeSource(t, root, "package.json", `{"dependencies":{"next":"`+tc.version+`"}}`)
			r, _, err := Analyze(context.Background(), ScanRequest{ProjectPath: root}, nil)
			if err != nil || (r.DangerCount > 0) != tc.danger {
				t.Fatalf("%v %+v", err, r)
			}
		})
	}
}

func TestSecretExamplesAndOverlap(t *testing.T) {
	root := t.TempDir()
	writeSource(t, root, ".env.example", "KEY=sk-"+strings.Repeat("x", 29)+"\nREAL=sk-"+strings.Repeat("A", 29))
	writeSource(t, root, "docs.md", "sk-ant-"+strings.Repeat("B", 32))
	writeSource(t, root, "placeholder.md", "sk-"+strings.Repeat("x", 29))
	writeSource(t, root, "long.md", "sk-"+strings.Repeat("x", 64)+"-actual-suffix")
	report, _, err := Analyze(context.Background(), ScanRequest{ProjectPath: root}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if report.DangerCount != 3 {
		t.Fatalf("expected three distinct non-placeholder findings, got %+v", report.Findings)
	}
	for _, f := range report.Findings {
		if f.File == "placeholder.md" {
			t.Fatal("placeholder flagged")
		}
		if f.File == ".env.example" && f.Line != 2 {
			t.Fatal("placeholder hid later credential")
		}
		if f.File == "docs.md" && f.Title != "Anthropic API Key" {
			t.Fatal("overlapping provider signature")
		}
	}
}

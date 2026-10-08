package deploy

import (
	"brain/server/internal/agent"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLegacyFingerprintAndProtection(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "app.log")
	if err := os.WriteFile(file, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	_, before, _, err := legacyTree(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("changed content"), 0600); err != nil {
		t.Fatal(err)
	}
	_, after, _, err := legacyTree(root)
	if err != nil || before == after {
		t.Fatal("changed artifact fingerprint unchanged")
	}
	if !overlapProtected(root, map[string]bool{file: true}) {
		t.Fatal("child reference not protected")
	}
	link := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(root, link); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := legacyTree(link); err == nil {
		t.Fatal("symlink root accepted")
	}
}

func TestLegacyRejectsDuplicateSelectionsBeforeInventory(t *testing.T) {
	_, err := LegacyApply(context.Background(), LegacyRequest{Items: []LegacySelection{{ID: "same"}, {ID: "same"}}})
	if err == nil || err.Error() != "duplicate selection" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLegacyOpenFilesPreserved(t *testing.T) {
	bin := t.TempDir()
	script := filepath.Join(bin, "lsof")
	if err := os.WriteFile(script, []byte("#!/bin/sh\necho n/active/application.log\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)
	if verifyNoOpenLegacyFiles(context.Background(), t.TempDir()) == nil {
		t.Fatal("open files permitted")
	}
	if err := os.WriteFile(script, []byte("#!/bin/sh\nexit 1\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := verifyNoOpenLegacyFiles(context.Background(), t.TempDir()); err != nil {
		t.Fatal(err)
	}
}

func TestLegacyQuarantineRestoreLifecycle(t *testing.T) {
	t.Setenv("PUTMEIN_CONFIG_PATH", filepath.Join(t.TempDir(), "settings.json"))
	t.Setenv("RAY_LIFECYCLE_DIR", t.TempDir())
	t.Setenv("RAY_HOST_RUNTIME_DIR", t.TempDir())
	original := agent.GetDeploymentsDir()
	root, _ := filepath.EvalSymlinks(t.TempDir())
	agent.SetDeploymentsDir(root)
	t.Cleanup(func() { agent.SetDeploymentsDir(original) })
	bin := t.TempDir()
	for name, script := range map[string]string{"docker": "#!/bin/sh\nexit 0\n", "lsof": "#!/bin/sh\nexit 1\n"} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte(script), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin)
	for i := 0; i < 5; i++ {
		path := filepath.Join(root, ".releases", "pipeline", fmt.Sprintf("run-%d", i))
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
		old := time.Now().Add(-time.Duration(40+i) * 24 * time.Hour)
		if err := os.Chtimes(path, old, old); err != nil {
			t.Fatal(err)
		}
	}
	req := LegacyRequest{Pipelines: map[string]LegacyOwner{"pipeline": {Owner: "owner", Project: "project"}}}
	items, err := LegacyReview(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	var selected LegacySelection
	count := 0
	for _, item := range items {
		if item.Eligible {
			count++
			selected = LegacySelection{item.ID, item.Fingerprint}
		}
	}
	if count != 2 {
		t.Fatalf("expected newest three retained: %+v", items)
	}
	req.Action = "quarantine"
	req.Items = []LegacySelection{selected}
	results, err := LegacyApply(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if results[0]["error"] != "" {
		t.Fatal(results)
	}
	if _, err := os.Stat(selected.ID); !os.IsNotExist(err) {
		t.Fatal("source not quarantined")
	}
	items, err = LegacyReview(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.Kind == "quarantine" {
			if item.Eligible {
				t.Fatal("seven-day retention bypassed")
			}
			req.Action = "restore"
			req.Items = []LegacySelection{{item.ID, item.Fingerprint}}
			results, err = LegacyApply(context.Background(), req)
			if err != nil {
				t.Fatal(err)
			}
			if results[0]["error"] != "" {
				t.Fatal(results)
			}
		}
	}
	if _, err := os.Stat(selected.ID); err != nil {
		t.Fatal("source not restored", err)
	}
}

package monitor

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCustomMonitoringConfiguration(t *testing.T) {
	t.Setenv("RAY_MONITOR_CONFIG_DIR", t.TempDir())
	c := DefaultMonitoringConfig()
	c.BuiltinEnabled = false
	c.Rules = []CustomLogRule{{ID: "payments", Pattern: `(?i)provider timeout`, Message: "Provider unavailable", Severity: SeverityError, Enabled: true, CooldownSeconds: 60}}
	if err := SaveMonitoringConfig("owner", "project", c); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadMonitoringConfig("owner", "project")
	if err != nil {
		t.Fatal(err)
	}
	matches := MatchConfiguredLogs(loaded, "PROVIDER TIMEOUT")
	if len(matches) != 1 || matches[0].CooldownSeconds != 60 {
		t.Fatalf("unexpected matches: %+v", matches)
	}
	other, _ := LoadMonitoringConfig("other", "project")
	if len(other.Rules) != 0 {
		t.Fatal("cross-owner settings")
	}
	c.Rules[0].Pattern = `(?<=unsafe)x`
	if ValidateMonitoringConfig(c) == nil {
		t.Fatal("unsupported regexp accepted")
	}
	c = DefaultMonitoringConfig()
	c.LogPaths = []string{"../secret"}
	if ValidateMonitoringConfig(c) == nil {
		t.Fatal("escaping path accepted")
	}
}

func TestStructuredDockerLogger(t *testing.T) {
	c := DefaultMonitoringConfig()
	c.BuiltinEnabled = false
	c.JSON.Enabled = true
	c.JSON.LevelField = "log.level"
	c.JSON.MessageField = "event.message"
	c.JSON.Levels = map[string]Severity{"50": SeverityError}
	matches := MatchConfiguredLogs(c, `2026-10-05T12:00:00.123Z {"log":{"level":50},"event":{"message":"database unavailable"}}`)
	if len(matches) != 1 || matches[0].Message != "database unavailable" {
		t.Fatalf("unexpected matches: %+v", matches)
	}
}

func TestCustomLoggerRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "private.log")
	if err := os.WriteFile(outside, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape.log")); err != nil {
		t.Fatal(err)
	}
	c := DefaultMonitoringConfig()
	c.LogPaths = []string{"escape.log"}
	if paths := configuredLogPaths(root, c); len(paths) != 0 {
		t.Fatalf("escaped: %v", paths)
	}
}

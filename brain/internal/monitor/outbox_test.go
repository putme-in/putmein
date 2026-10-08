package monitor

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestOutboxSurvivesRestartAndFailedDelivery(t *testing.T) {
	root := t.TempDir()
	t.Setenv("RAY_ALERT_OUTBOX_DIR", root)
	q, err := NewAlertOutbox(func(*Alert) error { return fmt.Errorf("offline") })
	if err != nil {
		t.Fatal(err)
	}
	detected := time.Now().UTC().Add(-time.Hour)
	alert := &Alert{ProjectID: "project", Message: "failure", Severity: SeverityError, CreatedAt: detected}
	if err = q.Enqueue(alert); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, alert.ID+".json")
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("event not privately persisted", err)
	}
	q.drain(context.Background())
	if _, err = os.Stat(path); err != nil {
		t.Fatal("failed delivery deleted event", err)
	}
	calls := 0
	restarted, err := NewAlertOutbox(func(saved *Alert) error {
		calls++
		if saved.ID != alert.ID || !saved.CreatedAt.Equal(detected) {
			t.Fatal("replay altered event")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	restarted.drain(context.Background())
	restarted.drain(context.Background())
	if calls != 1 {
		t.Fatalf("deliveries: %d", calls)
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("delivered event not removed")
	}
}
func TestOutboxPreservesMalformedEntriesAndRejectsCollisions(t *testing.T) {
	root := t.TempDir()
	t.Setenv("RAY_ALERT_OUTBOX_DIR", root)
	q, err := NewAlertOutbox(func(*Alert) error { t.Fatal("invalid event delivered"); return nil })
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "invalid.json")
	if err = os.WriteFile(path, []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	q.drain(context.Background())
	if _, err = os.Stat(path); err != nil {
		t.Fatal("malformed entry removed")
	}
	alert := &Alert{ProjectID: "project", Message: "first"}
	if err = q.Enqueue(alert); err != nil {
		t.Fatal(err)
	}
	alert.Message = "different"
	if q.Enqueue(alert) == nil {
		t.Fatal("event overwritten")
	}
}

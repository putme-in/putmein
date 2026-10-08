package deploy

import (
	"brain/server/internal/security"
	"testing"
	"time"
)

func TestScheduledScanDueAndDeliveryBackoff(t *testing.T) {
	now := time.Now()
	if !scheduledDue(scheduleState{}, 24, now) {
		t.Fatal("first scan not due")
	}
	if scheduledDue(scheduleState{AttemptedAt: now.Add(-time.Hour)}, 24, now) {
		t.Fatal("scan ran early")
	}
	if !scheduledDue(scheduleState{AttemptedAt: now.Add(-25 * time.Hour)}, 24, now) {
		t.Fatal("expired scan skipped")
	}
	pending := scheduleState{AttemptedAt: now, Pending: &security.SecurityReport{}, NextDeliveryAt: now.Add(15 * time.Minute)}
	if scheduledDue(pending, 24, now) {
		t.Fatal("delivery backoff ignored")
	}
	if !scheduledDue(pending, 24, now.Add(16*time.Minute)) {
		t.Fatal("pending report not retried")
	}
}

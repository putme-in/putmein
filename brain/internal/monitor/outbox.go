package monitor

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// AlertOutbox requires one Brain process per directory. Delivery is idempotent
// at Ray; an interrupted delivery leaves its durable event available for replay.
type AlertOutbox struct {
	root    string
	mu      sync.Mutex
	deliver func(*Alert) error
	cursor  string
}

func NewAlertOutbox(deliver func(*Alert) error) (*AlertOutbox, error) {
	root := os.Getenv("RAY_ALERT_OUTBOX_DIR")
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		root = filepath.Join(home, ".ray", "alert-outbox")
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("alert outbox must be a real directory")
	}
	if err := os.Chmod(root, 0700); err != nil {
		return nil, err
	}
	return &AlertOutbox{root: root, deliver: deliver}, nil
}
func syncOutboxDir(root string) error {
	dir, err := os.Open(root)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
func (q *AlertOutbox) Enqueue(alert *Alert) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if alert.ID == "" {
		alert.ID = uuid.NewString()
	}
	if _, err := uuid.Parse(alert.ID); err != nil {
		return fmt.Errorf("invalid alert event ID")
	}
	if alert.CreatedAt.IsZero() {
		alert.CreatedAt = time.Now().UTC()
	}
	body, err := json.Marshal(alert)
	if err != nil {
		return err
	}
	if len(body) > 64*1024 {
		return fmt.Errorf("alert exceeds 64 KiB outbox limit")
	}
	target := filepath.Join(q.root, alert.ID+".json")
	if previous, err := os.ReadFile(target); err == nil {
		if string(previous) != string(body) {
			return fmt.Errorf("alert ID already queued with different content")
		}
		return syncOutboxDir(q.root)
	} else if !os.IsNotExist(err) {
		return err
	}
	entries, err := os.ReadDir(q.root)
	if err != nil {
		return err
	}
	if len(entries) >= 10000 {
		return fmt.Errorf("alert outbox is full; restore Ray/database availability")
	}
	file, err := os.CreateTemp(q.root, ".pending-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(body); err != nil {
		file.Close()
		return err
	}
	if err = file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	if err = os.Rename(file.Name(), target); err != nil {
		return err
	}
	return syncOutboxDir(q.root)
}
func (q *AlertOutbox) drain(ctx context.Context) {
	entries, err := os.ReadDir(q.root)
	if err != nil {
		log.Printf("[monitor] outbox read failed: %v", err)
		return
	}
	// Advance between batches so permanently rejected events cannot starve later ones.
	ordered := append([]os.DirEntry{}, entries...)
	split := 0
	for split < len(entries) && entries[split].Name() <= q.cursor {
		split++
	}
	ordered = append(ordered[:0], entries[split:]...)
	ordered = append(ordered, entries[:split]...)
	processed := 0
	for _, entry := range ordered {
		if ctx.Err() != nil {
			return
		}
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		q.cursor = entry.Name()
		processed++
		if processed > 100 {
			return
		}
		path := filepath.Join(q.root, entry.Name())
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() || info.Size() > 64*1024 {
			log.Printf("[monitor] invalid outbox entry %s; preserved for review", entry.Name())
			continue
		}
		body, err := os.ReadFile(path)
		if err != nil {
			log.Printf("[monitor] outbox read failed: %v", err)
			continue
		}
		var alert Alert
		if json.Unmarshal(body, &alert) != nil || alert.ID+".json" != entry.Name() || alert.ProjectID == "" {
			log.Printf("[monitor] invalid outbox event %s; preserved for review", entry.Name())
			continue
		}
		if err = q.deliver(&alert); err != nil {
			log.Printf("[monitor] queued alert %s delivery failed: %v", alert.ID, err)
			continue
		}
		q.mu.Lock()
		err = os.Remove(path)
		if err == nil {
			err = syncOutboxDir(q.root)
		}
		q.mu.Unlock()
		if err != nil {
			log.Printf("[monitor] delivered alert cleanup failed: %v", err)
		}
	}
}
func (q *AlertOutbox) Run(ctx context.Context) {
	q.drain(ctx)
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			q.drain(ctx)
		}
	}
}

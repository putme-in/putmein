package monitor

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"brain/server/internal/hostlogs"
)

func TestManagedLogReaderCrossesRotation(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "application-test.log")
	if err := hostlogs.Initialize(dir); err != nil {
		t.Fatal(err)
	}
	writer, err := hostlogs.OpenWriter(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	if _, err := writer.Write([]byte(strings.Repeat("x", int(hostlogs.SegmentBytes)) + "\nnext\n")); err != nil {
		t.Fatal(err)
	}
	text, cursor, err := TailFile(dir, hostlogs.SegmentBytes-3)
	if err != nil || text != "xxx\nnext\n" || cursor != hostlogs.SegmentBytes+6 {
		t.Fatalf("read %q %d %v", text, cursor, err)
	}
	tail, err := ReadFileTail(dir, 1)
	if err != nil || tail != "next" {
		t.Fatalf("tail %q %v", tail, err)
	}
	text, next, err := TailFile(dir, cursor)
	if err != nil || text != "" || next != cursor {
		t.Fatal("replayed rotated logs")
	}
}
func TestLegacyLogReaderStillSupportsTruncation(t *testing.T) {
	file := filepath.Join(t.TempDir(), "old.log")
	if err := os.WriteFile(file, []byte("original output"), 0600); err != nil {
		t.Fatal(err)
	}
	_, cursor, err := TailFile(file, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	text, next, err := TailFile(file, cursor)
	if err != nil || text != "new" || next != 3 {
		t.Fatalf("legacy read %q %d %v", text, next, err)
	}
}

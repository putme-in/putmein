package hostlogs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testWriter(t *testing.T, limit int64, keep int) (string, *Writer) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "application-test.log")
	if err := Initialize(dir); err != nil {
		t.Fatal(err)
	}
	w, err := newWriter(dir, limit, keep)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = w.Close() })
	return dir, w
}
func TestRotationBoundsAndMonotonicCursor(t *testing.T) {
	dir, w := testWriter(t, 8, 3)
	if _, err := w.Write([]byte("abcdefghij")); err != nil {
		t.Fatal(err)
	}
	text, cursor, err := ReadSince(dir, 0, 64)
	if err != nil || text != "abcdefghij" || cursor != 10 {
		t.Fatalf("first read %q %d %v", text, cursor, err)
	}
	if _, err := w.Write([]byte("klmnopqrstuvwxyz")); err != nil {
		t.Fatal(err)
	}
	text, next, err := ReadSince(dir, cursor, 64)
	if err != nil || text != "klmnopqrstuvwxyz" || next != 26 {
		t.Fatalf("rotated read %q %d %v", text, next, err)
	}
	entries, err := segments(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("kept %d segments", len(entries))
	}
	for _, entry := range entries {
		if entry.size > 8 {
			t.Fatal("oversized segment")
		}
	}
	text, _, err = ReadSince(dir, 0, 64)
	if err != nil || !strings.Contains(text, "skipped 8 unread bytes") || !strings.HasSuffix(text, "ijklmnopqrstuvwxyz") {
		t.Fatalf("missing retention notice: %q %v", text, err)
	}
}
func TestTailSpansSegmentsAndNoDuplicatePoll(t *testing.T) {
	dir, w := testWriter(t, 8, 3)
	_, err := w.Write([]byte("one\ntwo\nthree\nfour\n"))
	if err != nil {
		t.Fatal(err)
	}
	tail, err := ReadTail(dir, 3)
	if err != nil || tail != "two\nthree\nfour" {
		t.Fatalf("tail %q %v", tail, err)
	}
	_, cursor, err := ReadSince(dir, 0, 64)
	if err != nil {
		t.Fatal(err)
	}
	text, next, err := ReadSince(dir, cursor, 64)
	if err != nil || text != "" || next != cursor {
		t.Fatal("duplicate output")
	}
}
func TestRefusesAdoptionAndSymlinkSegments(t *testing.T) {
	dir, w := testWriter(t, 8, 3)
	if _, err := OpenWriter(dir); err == nil {
		t.Fatal("second writer adopted active log")
	}
	_ = w.Close()
	external := filepath.Join(t.TempDir(), "outside")
	_ = os.WriteFile(external, []byte("private"), 0600)
	if err := os.Symlink(external, filepath.Join(dir, "00000000000000000008.log")); err != nil {
		t.Skip(err)
	}
	if _, _, err := ReadSince(dir, 0, 64); err == nil {
		t.Fatal("followed symlink segment")
	}
	if Expired(dir, time.Now().Add(time.Hour).Unix()) {
		t.Fatal("unsafe directory eligible for cleanup")
	}
}
func TestExpiryRequiresEverySegmentToBeOld(t *testing.T) {
	dir, w := testWriter(t, 8, 3)
	_, _ = w.Write([]byte("output"))
	_ = w.Close()
	old := time.Now().Add(-8 * 24 * time.Hour)
	files, _ := os.ReadDir(dir)
	for _, file := range files {
		if err := os.Chtimes(filepath.Join(dir, file.Name()), old, old); err != nil {
			t.Fatal(err)
		}
	}
	cutoff := time.Now().Add(-7 * 24 * time.Hour).Unix()
	if !Expired(dir, cutoff) {
		t.Fatal("retired logs did not expire")
	}
	entries, _ := segments(dir)
	if err := os.Chtimes(entries[0].path, time.Now(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if Expired(dir, cutoff) {
		t.Fatal("recent output expired")
	}
}

func TestRotationFailureNeverOverwritesUnexpectedFile(t *testing.T) {
	dir, w := testWriter(t, 4, 3)
	_, _ = w.Write([]byte("abcd"))
	next := filepath.Join(dir, "00000000000000000004.log")
	if err := os.WriteFile(next, []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("e")); err == nil {
		t.Fatal("overwrote unexpected segment")
	}
	if _, err := w.Write([]byte("f")); err == nil {
		t.Fatal("writer resumed after a rotation failure")
	}
	raw, _ := os.ReadFile(next)
	if string(raw) != "preserve" {
		t.Fatal("unrelated contents changed")
	}
}

// Package hostlogs stores bounded application output in immutable-offset segments.
// The logical .log path is a private directory; offsets never reset on rotation.
package hostlogs

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
)

const SegmentBytes int64 = 10 * 1024 * 1024
const SegmentCount = 3
const format = "ray-host-logs-v1"

type metadata struct {
	Format string `json:"format"`
}
type segment struct {
	path        string
	start, size int64
}

// Initialize creates a fresh log location. Never adopt or overwrite existing files.
func Initialize(dir string) error {
	if err := os.Mkdir(dir, 0700); err != nil {
		return err
	}
	raw, _ := json.Marshal(metadata{Format: format})
	return os.WriteFile(filepath.Join(dir, "format.json"), raw, 0600)
}
func IsManaged(dir string) bool {
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() {
		return false
	}
	metaPath := filepath.Join(dir, "format.json")
	metaInfo, err := os.Lstat(metaPath)
	if err != nil || !metaInfo.Mode().IsRegular() || metaInfo.Size() > 1024 {
		return false
	}
	raw, err := os.ReadFile(metaPath)
	if err != nil {
		return false
	}
	var meta metadata
	return json.Unmarshal(raw, &meta) == nil && meta.Format == format
}
func segments(dir string) ([]segment, error) {
	if !IsManaged(dir) {
		return nil, fmt.Errorf("unrecognized managed log directory")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := []segment{}
	for _, entry := range entries {
		name := entry.Name()
		start, ok := segmentStart(name)
		if !ok {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("managed log segment is not a regular file")
		}
		out = append(out, segment{filepath.Join(dir, name), start, info.Size()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].start < out[j].start })
	return out, nil
}

type Writer struct {
	mu          sync.Mutex
	dir         string
	limit       int64
	keep        int
	file        *os.File
	start, size int64
	failure     error
}

func OpenWriter(dir string) (*Writer, error) { return newWriter(dir, SegmentBytes, SegmentCount) }
func newWriter(dir string, limit int64, keep int) (*Writer, error) {
	entries, err := segments(dir)
	if err != nil {
		return nil, err
	}
	if len(entries) != 0 || limit <= 0 || keep < 1 {
		return nil, fmt.Errorf("log writer requires a fresh location and valid limits")
	}
	w := &Writer{dir: dir, limit: limit, keep: keep}
	if err := w.next(); err != nil {
		if w.file != nil {
			_ = w.file.Close()
		}
		return nil, err
	}
	return w, nil
}
func (w *Writer) next() error {
	nextStart := w.start + w.size
	next, err := os.OpenFile(filepath.Join(w.dir, fmt.Sprintf("%020d.log", nextStart)), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if w.file != nil {
		if err := w.file.Close(); err != nil {
			next.Close()
			return err
		}
	}
	w.file = next
	w.start = nextStart
	w.size = 0
	entries, err := segments(w.dir)
	if err != nil {
		return err
	}
	for len(entries) > w.keep {
		if err := os.Remove(entries[0].path); err != nil {
			return err
		}
		entries = entries[1:]
	}
	return nil
}
func (w *Writer) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.failure != nil {
		return 0, w.failure
	}
	if w.file == nil {
		return 0, os.ErrClosed
	}
	total := 0
	for len(p) > 0 {
		if w.size == w.limit {
			if err := w.next(); err != nil {
				w.failure = err
				return total, err
			}
		}
		count := len(p)
		if int64(count) > w.limit-w.size {
			count = int(w.limit - w.size)
		}
		n, err := w.file.Write(p[:count])
		w.size += int64(n)
		total += n
		p = p[n:]
		if err != nil {
			w.failure = err
			return total, err
		}
		if n == 0 {
			w.failure = io.ErrShortWrite
			return total, w.failure
		}
	}
	return total, nil
}
func (w *Writer) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return nil
	}
	err := w.file.Close()
	w.file = nil
	return err
}
func readRange(entry segment, offset, limit int64) ([]byte, error) {
	info, err := os.Lstat(entry.path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("unsafe log segment")
	}
	f, err := os.Open(entry.path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	actual, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !os.SameFile(info, actual) {
		return nil, fmt.Errorf("log segment changed while opening")
	}
	if _, err := f.Seek(offset-entry.start, io.SeekStart); err != nil {
		return nil, err
	}
	return io.ReadAll(io.LimitReader(f, limit))
}

// ReadSince returns a monotonic cursor, with an explicit notice if retention
// overtook a reader. Missing segments during pruning are retried on the next poll.
func ReadSince(dir string, offset int64, maxBytes int64) (string, int64, error) {
	entries, err := segments(dir)
	if err != nil {
		return "", offset, err
	}
	if len(entries) == 0 {
		return "", offset, nil
	}
	original := offset
	notice := ""
	if offset < entries[0].start {
		notice = fmt.Sprintf("[RAY] WARNING: log retention skipped %d unread bytes; continuing from retained output.\n", entries[0].start-offset)
		offset = entries[0].start
	}
	var out strings.Builder
	for _, entry := range entries {
		if offset >= entry.start+entry.size {
			continue
		}
		if offset < entry.start {
			return "", original, fmt.Errorf("gap in managed log segments")
		}
		count := entry.start + entry.size - offset
		if count > maxBytes {
			count = maxBytes
		}
		data, err := readRange(entry, offset, count)
		if err != nil {
			return "", original, err
		}
		out.Write(data)
		offset += int64(len(data))
		maxBytes -= int64(len(data))
		if int64(len(data)) < count || maxBytes <= 0 {
			break
		}
	}
	return notice + out.String(), offset, nil
}
func ReadTail(dir string, lines int) (string, error) {
	entries, err := segments(dir)
	if err != nil {
		return "", err
	}
	if len(entries) == 0 {
		return "", nil
	}
	last := entries[len(entries)-1]
	start := last.start + last.size - 2*1024*1024
	if start < entries[0].start {
		start = entries[0].start
	}
	text, _, err := ReadSince(dir, start, 2*1024*1024)
	if err != nil {
		return "", err
	}
	if lines <= 0 {
		lines = 100
	}
	rows := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if len(rows) > lines {
		rows = rows[len(rows)-lines:]
	}
	return strings.Join(rows, "\n"), nil
}

// Expired validates every entry and requires all segment timestamps to be old.
// It never follows symlinks or treats an arbitrary .log directory as disposable.
func Expired(dir string, cutoff int64) bool {
	if !IsManaged(dir) {
		return false
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() || info.ModTime().Unix() >= cutoff {
			return false
		}
		if entry.Name() == "format.json" {
			continue
		}
		if _, ok := segmentStart(entry.Name()); !ok {
			return false
		}
	}
	return true
}

func segmentStart(name string) (int64, bool) {
	if len(name) != 24 || !strings.HasSuffix(name, ".log") {
		return 0, false
	}
	for _, ch := range name[:20] {
		if ch < '0' || ch > '9' {
			return 0, false
		}
	}
	start, err := strconv.ParseInt(name[:20], 10, 64)
	return start, err == nil && start >= 0
}

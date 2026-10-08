//go:build linux || darwin

package hostlogs

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestCollectorHelper(t *testing.T) {
	if os.Getenv("RAY_TEST_LOG_HELPER") != "1" {
		return
	}
	os.Exit(Run(os.Getenv("RAY_TEST_LOG_DIR"), "printf 'stdout-line\\n'; printf 'stderr-line\\n' >&2"))
}
func TestCollectorOwnsOutputAndReapsGroup(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "application-test.log")
	if err := Initialize(dir); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestCollectorHelper$")
	cmd.Env = append(os.Environ(), "RAY_TEST_LOG_HELPER=1", "RAY_TEST_LOG_DIR="+dir)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done: // The collector deliberately reaps its complete group after flushing.
	case <-time.After(5 * time.Second):
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		<-done
		t.Fatal("collector did not exit")
	}
	output, err := ReadTail(dir, 20)
	if err != nil || !strings.Contains(output, "stdout-line") || !strings.Contains(output, "stderr-line") || !strings.Contains(output, "Managed process exited.") {
		t.Fatalf("output %q %v", output, err)
	}
}

func TestCollectorDetachedLauncher(t *testing.T) {
	if os.Getenv("RAY_TEST_LOG_LAUNCHER") != "1" {
		return
	}
	child := exec.Command(os.Args[0], "-test.run=^TestCollectorDelayedHelper$")
	child.Env = append(os.Environ(), "RAY_TEST_LOG_DELAYED=1")
	child.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := child.Start(); err != nil {
		os.Exit(2)
	}
	if err := os.WriteFile(filepath.Join(os.Getenv("RAY_TEST_LOG_DIR"), "test-pid"), []byte(strconv.Itoa(child.Process.Pid)), 0600); err != nil {
		os.Exit(3)
	}
	os.Exit(0)
}
func TestCollectorDelayedHelper(t *testing.T) {
	if os.Getenv("RAY_TEST_LOG_DELAYED") != "1" {
		return
	}
	os.Exit(Run(os.Getenv("RAY_TEST_LOG_DIR"), "sleep 0.2; printf 'output-after-parent-exit\\n'"))
}
func TestCollectorSurvivesParentExit(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "application-test.log")
	if err := Initialize(dir); err != nil {
		t.Fatal(err)
	}
	parent := exec.Command(os.Args[0], "-test.run=^TestCollectorDetachedLauncher$")
	parent.Env = append(os.Environ(), "RAY_TEST_LOG_LAUNCHER=1", "RAY_TEST_LOG_DIR="+dir)
	if err := parent.Run(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "test-pid"))
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(string(raw))
	if err != nil || pid <= 1 {
		t.Fatal("invalid fixture process")
	}
	defer syscall.Kill(-pid, syscall.SIGKILL)
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		output, err := ReadTail(dir, 20)
		if err == nil && strings.Contains(output, "output-after-parent-exit") && strings.Contains(output, "Managed process exited.") {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("collector did not keep logging after its launcher exited")
}

func TestCollectorTermHelper(t *testing.T) {
	if os.Getenv("RAY_TEST_LOG_TERM") != "1" {
		return
	}
	os.Exit(Run(os.Getenv("RAY_TEST_LOG_DIR"), "trap 'printf \"shutdown-flushed\\n\"; exit 0' TERM; printf 'ready\\n'; while :; do sleep 0.05; done"))
}
func TestCollectorDrainsOnManagedGroupStop(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "application-test.log")
	if err := Initialize(dir); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestCollectorTermHelper$")
	cmd.Env = append(os.Environ(), "RAY_TEST_LOG_TERM=1", "RAY_TEST_LOG_DIR="+dir)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	defer syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	ready := false
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		output, _ := ReadTail(dir, 20)
		if strings.Contains(output, "ready") {
			ready = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !ready {
		t.Fatal("application fixture not ready")
	}
	if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(4 * time.Second):
		t.Fatal("managed group did not stop")
	}
	output, err := ReadTail(dir, 20)
	if err != nil || !strings.Contains(output, "shutdown-flushed") {
		t.Fatalf("shutdown output lost: %q %v", output, err)
	}
}

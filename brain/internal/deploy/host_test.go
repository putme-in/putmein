package deploy

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHostEnvironmentExcludesBrainSecrets(t *testing.T) {
	t.Setenv("JWT_SECRET", "platform-secret-fixture")
	t.Setenv("BRAIN_INTERNAL_SECRET", "internal-secret-fixture")
	t.Setenv("DATABASE_URL", "database-fixture")
	values, err := hostEnvironment(DeployRequest{EnvVars: map[string]string{"APP_KEY": "application-value", "PORT": "9999"}}, t.TempDir(), 4050)
	if err != nil {
		t.Fatal(err)
	}
	env := strings.Join(values, "\n")
	for _, name := range []string{"JWT_SECRET=", "BRAIN_INTERNAL_SECRET=", "DATABASE_URL="} {
		if strings.Contains(env, name) {
			t.Fatalf("inherited %s", name)
		}
	}
	if !strings.Contains(env, "APP_KEY=application-value") || !strings.Contains(env, "PORT=4050") {
		t.Fatal("missing explicit app settings")
	}
	if _, err := hostEnvironment(DeployRequest{EnvVars: map[string]string{"BAD=NAME": "x"}}, t.TempDir(), 4050); err == nil {
		t.Fatal("accepted invalid variable name")
	}
}
func TestHostProcessIdentityAndStop(t *testing.T) {
	if !hostSupported() {
		t.Skip("host execution requires Linux or macOS")
	}
	marker := randomHostMarker()
	cmd := hostCommand("sleep 30", marker)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { _ = cmd.Wait(); close(done) }()
	t.Cleanup(func() {
		killOwnedHostGroup(cmd.Process.Pid)
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Error("test process did not exit")
		}
	})
	deadline := time.Now().Add(3 * time.Second)
	for !hostProcessAlive(cmd.Process.Pid, marker) && time.Now().Before(deadline) {
		time.Sleep(25 * time.Millisecond)
	}
	if !hostProcessAlive(cmd.Process.Pid, marker) {
		t.Fatal("could not verify owned process identity")
	}
	if hostProcessAlive(cmd.Process.Pid, "wrong-marker") {
		t.Fatal("accepted unrelated identity")
	}
	if err := terminateHostGroup(cmd.Process.Pid, "wrong-marker"); err != nil {
		t.Fatal(err)
	}
	if !hostProcessAlive(cmd.Process.Pid, marker) {
		t.Fatal("wrong identity stopped a process")
	}
	if err := terminateHostGroup(cmd.Process.Pid, marker); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("stop did not terminate owned process")
	}
}
func TestHostSourceStaging(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source")
	base := filepath.Join(root, "deployments")
	if err := os.MkdirAll(source, 0700); err != nil {
		t.Fatal(err)
	}
	original := filepath.Join(source, "app.txt")
	if err := os.WriteFile(original, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	handle := hostHandle(DeployRequest{UserID: "owner", ProjectID: "project"})
	release, err := stageHostSourceAt(context.Background(), source, handle, base)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(release, "app.txt"), []byte("built"), 0600); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(original)
	if err != nil || string(data) != "original" {
		t.Fatal("staging changed source")
	}
	if err := os.Symlink(filepath.Join(root, "outside"), filepath.Join(source, "escape")); err != nil {
		t.Skip("symlinks unavailable")
	}
	if _, err = stageHostSourceAt(context.Background(), source, handle, base); err == nil {
		t.Fatal("accepted escaping or broken symlink")
	}
	if _, err = stageHostSourceAt(context.Background(), source, handle, source); err == nil {
		t.Fatal("accepted deployment destination inside source")
	}
}
func TestHostStateIdentityAndPermissions(t *testing.T) {
	t.Setenv("RAY_HOST_RUNTIME_DIR", t.TempDir())
	request := DeployRequest{UserID: "owner", ProjectID: "project"}
	handle := hostHandle(request)
	if err := writeHostState(&hostState{Request: request, Handle: handle, Status: "stopped"}); err != nil {
		t.Fatal(err)
	}
	state, err := readHostState(handle)
	if err != nil || state.Status != "stopped" {
		t.Fatal("state did not round-trip")
	}
	directory, _ := hostDir(handle)
	info, err := os.Stat(filepath.Join(directory, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("state permissions are %o", info.Mode().Perm())
	}
	if _, err := hostDir("process:../../escape"); err == nil {
		t.Fatal("accepted invalid runtime handle")
	}
	if handle == hostHandle(DeployRequest{UserID: "another-owner", ProjectID: "project"}) {
		t.Fatal("runtime identity not owner-scoped")
	}
}

package deploy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func isolateLifecycle(t *testing.T) {
	t.Helper()
	t.Setenv("RAY_LIFECYCLE_DIR", t.TempDir())
	t.Setenv("RAY_HOST_RUNTIME_DIR", t.TempDir())
	t.Setenv("RAY_ROUTING_DIR", t.TempDir())
	t.Setenv("BRAIN_INTERNAL_SECRET", "")
}

func TestLifecycleLockExcludesOtherHandles(t *testing.T) {
	isolateLifecycle(t)
	release, err := AcquireOperation()
	if err != nil {
		t.Fatal(err)
	}
	if other, err := AcquireOperation(); err == nil {
		other()
		t.Fatal("overlapping operation acquired lock")
	}
	release()
	again, err := AcquireOperation()
	if err != nil {
		t.Fatal(err)
	}
	again()
}

func TestCleanupProtectsRuntimeAndRequiresPreviewSelection(t *testing.T) {
	isolateLifecycle(t)
	req := DeployRequest{UserID: "owner", ProjectID: "project"}
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(base, ".security-releases", strings.TrimPrefix(hostHandle(req), hostPrefix))
	var paths []string
	for i := 0; i < 6; i++ {
		path := filepath.Join(root, fmt.Sprintf("release-%d", i))
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(path, "source.txt"), []byte("retained source"), 0600); err != nil {
			t.Fatal(err)
		}
		item := releaseArtifact{Path: path, CreatedAt: time.Now().Add(-time.Duration(10+i) * 24 * time.Hour), Request: req, Status: "healthy"}
		if err := atomicSecurityJSON(artifactFile(req, path), item); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, path)
	}
	if err := atomicSecurityJSON(filepath.Join(lifecycleRoot(), "runtimes", "test", "previous.json"), map[string]string{"projectPath": paths[4]}); err != nil {
		t.Fatal(err)
	}
	preview, err := CleanupProject(req, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview) != 2 || preview[0].Path != paths[3] || preview[1].Path != paths[5] {
		t.Fatalf("unexpected candidates: %+v", preview)
	}
	if _, err := os.Stat(paths[3]); err != nil {
		t.Fatal("preview removed source")
	}
	applied, err := CleanupProject(req, true, []string{paths[3]})
	if err != nil {
		t.Fatal(err)
	}
	if len(applied) != 1 || !applied[0].Removed {
		t.Fatalf("unexpected cleanup: %+v", applied)
	}
	for _, p := range []string{paths[4], paths[5]} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("unapproved/protected source lost: %s", p)
		}
	}
	// A protected parent must also preserve its descendants.
	req.ProjectPath = root
	remaining, err := CleanupProject(req, false, nil)
	if err != nil || len(remaining) != 0 {
		t.Fatalf("protected parent ignored: %+v %v", remaining, err)
	}
}

func TestCleanupFailsClosedOnInvalidState(t *testing.T) {
	isolateLifecycle(t)
	dir := filepath.Join(lifecycleRoot(), "runtimes", "test")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "pending.json"), []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := CleanupProject(DeployRequest{UserID: "o", ProjectID: "p"}, true, nil); err == nil {
		t.Fatal("invalid journal did not block cleanup")
	}
}

func fakeLifecycleDocker(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	log := filepath.Join(dir, "calls")
	script := `#!/bin/sh
printf '%s\n' "$*" >> "$RAY_TEST_DOCKER_CALLS"
case "$1" in
 ps) printf '%s\n' old ;;
 inspect)
  case "$5" in
   old) printf '%s\n' '[{"Id":"old","Name":"/app-previous","State":{"Running":false},"Config":{"Image":"old-image","Labels":{"io.ray.owner":"owner"}}}]' ;;
   *) printf '%s\n' "$RAY_TEST_CURRENT" ;;
  esac ;;
 stop|start|rename|rm) exit 0 ;;
 *) exit 1 ;;
esac
`
	if err := os.WriteFile(filepath.Join(dir, "docker"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("RAY_TEST_DOCKER_CALLS", log)
	return log
}

func TestDockerFailureRestoresRetainedContainer(t *testing.T) {
	isolateLifecycle(t)
	log := fakeLifecycleDocker(t)
	t.Setenv("RAY_TEST_CURRENT", `[{"Id":"candidate","Name":"/app","State":{"Running":true},"Config":{"Image":"new-image","Labels":{"io.ray.owner":"owner"}}}]`)

	journal := &dockerJournal{Request: DeployRequest{UserID: "owner"}, Name: "app", Image: "new-image", PreviousID: "old", PreviousName: "app-previous", WasRunning: true}
	if err := atomicSecurityJSON(filepath.Join(runtimeDir("app"), "pending.json"), journal); err != nil {
		t.Fatal(err)
	}
	if err := journal.restore(context.Background()); err != nil {
		t.Fatal(err)
	}
	calls, _ := os.ReadFile(log)
	for _, call := range []string{"rm -f candidate", "rename old app", "start old"} {
		if !strings.Contains(string(calls), call) {
			t.Fatalf("missing %s: %s", call, calls)
		}
	}
	if strings.Contains(string(calls), "rm -f old") {
		t.Fatal("previous container deleted")
	}
	if _, err := os.Stat(filepath.Join(runtimeDir("app"), "pending.json")); !os.IsNotExist(err) {
		t.Fatal("recovery journal not cleared")
	}
}

func TestDockerRecoveryRejectsUnexpectedContainer(t *testing.T) {
	isolateLifecycle(t)
	log := fakeLifecycleDocker(t)
	t.Setenv("RAY_TEST_CURRENT", `[{"Id":"other","Name":"/app","Config":{"Image":"unrelated","Labels":{"io.ray.owner":"someone"}}}]`)
	journal := &dockerJournal{Request: DeployRequest{UserID: "owner"}, Name: "app", Image: "new-image"}
	if err := journal.restore(context.Background()); err == nil {
		t.Fatal("unexpected container replaced")
	}
	calls, _ := os.ReadFile(log)
	if strings.Contains(string(calls), "rm ") {
		t.Fatal("unexpected container removed")
	}
}

func TestCommittedJournalRecoveryOnlyFinishesIndex(t *testing.T) {
	isolateLifecycle(t)
	release := &runtimeRelease{Request: DeployRequest{UserID: "owner"}, Result: DeployResult{ContainerName: "app", ContainerID: "new"}}
	journal := &dockerJournal{Name: "app", Completed: release}
	if err := atomicSecurityJSON(filepath.Join(runtimeDir("app"), "pending.json"), journal); err != nil {
		t.Fatal(err)
	}
	if err := RecoverDockerReplacement("app"); err != nil {
		t.Fatal(err)
	}
	active, err := readActiveRelease("app")
	if err != nil || active.Result.ContainerID != "new" {
		t.Fatalf("committed release lost: %+v %v", active, err)
	}
}

func TestDeletionReservationBlocksLifecycleAndDeletedProject(t *testing.T) {
	isolateLifecycle(t)
	token, err := BeginProjectDeletion("owner", "project")
	if err != nil {
		t.Fatal(err)
	}
	if release, err := AcquireOperation(); err == nil {
		release()
		t.Fatal("deployment entered active deletion")
	}
	resumed, err := BeginProjectDeletion("owner", "project")
	if err != nil || resumed != token {
		t.Fatal("interrupted deletion cannot resume")
	}
	if _, err := BeginProjectDeletion("someone", "other"); err == nil {
		t.Fatal("unrelated deletion bypassed reservation")
	}
	if err := FinishProjectDeletion("wrong", true); err == nil {
		t.Fatal("wrong token released reservation")
	}
	if err := FinishProjectDeletion(token, true); err != nil {
		t.Fatal(err)
	}
	release, err := AcquireOperation()
	if err != nil {
		t.Fatal(err)
	}
	release()
	if err := checkProjectNotDeleted(DeployRequest{UserID: "owner", ProjectID: "project"}); err == nil {
		t.Fatal("deleted project can be resurrected")
	}
	if err := checkProjectNotDeleted(DeployRequest{UserID: "owner", ProjectID: "new-project"}); err != nil {
		t.Fatal(err)
	}
}

func TestRetiredHostLogsPreserveActiveAndPrevious(t *testing.T) {
	isolateLifecycle(t)
	req := DeployRequest{UserID: "owner", ProjectID: "project"}
	dir, err := hostDir(hostHandle(req))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	active := filepath.Join(dir, "application-active.log")
	previous := filepath.Join(dir, "application-previous.log")
	retired := filepath.Join(dir, "application-retired.log")
	recent := filepath.Join(dir, "application-recent.log")
	for _, file := range []string{active, previous, retired, recent} {
		if err := os.WriteFile(file, []byte("application output"), 0600); err != nil {
			t.Fatal(err)
		}
		if file != recent {
			old := time.Now().Add(-8 * 24 * time.Hour)
			if err := os.Chtimes(file, old, old); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := atomicSecurityJSON(filepath.Join(dir, "state.json"), map[string]string{"logFile": active}); err != nil {
		t.Fatal(err)
	}
	if err := atomicSecurityJSON(filepath.Join(dir, "previous.json"), map[string]string{"logFile": previous}); err != nil {
		t.Fatal(err)
	}
	if err := maintainHostLogs(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(retired); !os.IsNotExist(err) {
		t.Fatal("expired log not removed")
	}
	for _, file := range []string{active, previous, recent} {
		if _, err := os.Stat(file); err != nil {
			t.Fatalf("protected/recent log removed: %s", file)
		}
	}
}

func TestCompletedHostJournalIndexesPreviousWithoutStartingProcess(t *testing.T) {
	isolateLifecycle(t)
	req := DeployRequest{UserID: "owner", ProjectID: "project"}
	handle := hostHandle(req)
	previous := &hostState{Request: req, Handle: handle, Status: "stopped"}
	completed := &hostState{Request: req, Handle: handle, Status: "stopped", Marker: "committed-marker"}
	journal := &hostJournal{Request: req, Previous: previous, Completed: completed}
	if err := atomicSecurityJSON(hostJournalPath(handle), journal); err != nil {
		t.Fatal(err)
	}
	if err := RecoverHostReplacement(handle); err != nil {
		t.Fatal(err)
	}
	state, err := readHostState(handle)
	if err != nil || state.Marker != "committed-marker" {
		t.Fatal("committed host state lost")
	}
	dir, _ := hostDir(handle)
	if _, err := os.Stat(filepath.Join(dir, "previous.json")); err != nil {
		t.Fatal(err)
	}
}

func TestRecoveryOwnershipAndLegacyContainerID(t *testing.T) {
	isolateLifecycle(t)
	release := &runtimeRelease{Request: DeployRequest{UserID: "owner", ProjectID: "project"}, Result: DeployResult{ContainerName: "app"}}
	if err := atomicSecurityJSON(filepath.Join(runtimeDir("app"), "active.json"), release); err != nil {
		t.Fatal(err)
	}
	if err := ValidateRecoveryOwner("app", "owner", "project"); err != nil {
		t.Fatal(err)
	}
	if err := ValidateRecoveryOwner("app", "other", "project"); err == nil {
		t.Fatal("cross-owner recovery allowed")
	}
	if err := ValidateRecoveryOwner("app", "owner", "other"); err == nil {
		t.Fatal("cross-project recovery allowed")
	}
	if !sameContainerID("0123456789ab", "0123456789abcdef") {
		t.Fatal("legacy display ID rejected")
	}
	if sameContainerID("0123", "0123456789abcdef") || sameContainerID("0123456789ac", "0123456789abcdef") {
		t.Fatal("unrelated ID accepted")
	}
}

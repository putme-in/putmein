package monitor

import (
	"context"
	"strings"
	"testing"
)

func TestDiagnoseFallbackDockerNamedPipe(t *testing.T) {
	logs := `[ERROR] failed to build image: error during connect: Get "http://%2F%2F.%2Fpipe%2Fdocker_engine/v1.24/containers/json": open //./pipe/docker_engine: The system cannot find the file specified.`
	diag := generateFallbackDiagnosis("", "docker build & deploy", logs, false)

	if !strings.Contains(diag.Summary, "Docker Engine Connection Failed") {
		t.Errorf("expected Docker Engine Connection Failed, got: %s", diag.Summary)
	}
	if !strings.Contains(diag.RootCause, "named pipe") {
		t.Errorf("expected mention of named pipe, got: %s", diag.RootCause)
	}
	if diag.CanAutoFix {
		t.Errorf("expected CanAutoFix to be false for Docker connection failure")
	}
}

func TestDiagnoseFallbackDockerDaemonLinux(t *testing.T) {
	logs := `Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?`
	diag := generateFallbackDiagnosis("", "docker build & deploy", logs, false)

	if !strings.Contains(diag.Summary, "Docker Engine Connection Failed") {
		t.Errorf("expected Docker Engine Connection Failed, got: %s", diag.Summary)
	}
}

func TestDiagnoseWithoutProjectPath(t *testing.T) {
	logs := `error during connect: open //./pipe/docker_engine`
	diag, err := DiagnoseProject(context.Background(), "invalid-model-id", "", "docker build & deploy", logs)
	if err != nil {
		t.Fatalf("expected DiagnoseProject to succeed with empty projectPath when logs are provided, got error: %v", err)
	}
	if diag == nil {
		t.Fatalf("expected non-nil diagnosis")
	}
	if !strings.Contains(diag.Summary, "Docker Engine Connection Failed") {
		t.Errorf("expected Docker Engine Connection Failed, got: %s", diag.Summary)
	}
}

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

func TestDiagnoseFallbackEJSONPARSE(t *testing.T) {
	logs := `npm error code EJSONPARSE
npm error JSON.parse Expected ',' or '}' after property value in JSON at position 123 (line 8 column 3) while parsing '{...}'
npm error JSON.parse Failed to parse JSON data.
npm error JSON.parse package.json must be actual JSON, not just JavaScript.`
	diag := generateFallbackDiagnosis("", "docker build & deploy", logs, false)

	if !strings.Contains(diag.Summary, "Package Manifest Syntax Error") {
		t.Errorf("expected Package Manifest Syntax Error, got: %s", diag.Summary)
	}
	if !strings.Contains(diag.RootCause, "EJSONPARSE") || !strings.Contains(diag.RootCause, "package.json") {
		t.Errorf("expected EJSONPARSE and package.json in RootCause, got: %s", diag.RootCause)
	}
	if diag.CanAutoFix {
		t.Errorf("expected CanAutoFix to be false for package.json syntax error")
	}
	if len(diag.Commands) != 0 {
		t.Errorf("expected empty commands for syntax error requiring manual fix, got: %v", diag.Commands)
	}
}

func TestDiagnoseFallbackDockerDoesNotBlameMissingNodeModules(t *testing.T) {
	logs := `Step 4/10 : RUN npm run build
> build
> tsc && vite build
error: command failed`
	diag := generateFallbackDiagnosis("", "docker build & deploy", logs, false)

	if strings.Contains(diag.Summary, "Missing dependencies") || strings.Contains(diag.RootCause, "node_modules") {
		t.Errorf("docker container builds should not falsely diagnose missing local node_modules, got summary: %s, rootCause: %s", diag.Summary, diag.RootCause)
	}
	if diag.CanAutoFix {
		t.Errorf("docker build failure should not be marked auto-fixable with local commands")
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


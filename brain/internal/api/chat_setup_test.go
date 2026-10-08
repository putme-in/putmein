package api

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestChatDeploymentRequestsSetupWithoutExecuting(t *testing.T) {
	for _, source := range []string{"/does/not/exist", "https://github.com/example/app"} {
		var emitted string
		output := runDetectedTool(context.Background(), "", "deploy", "app|"+source+"|4444", "owner", "secret", func(chunk string) { emitted += chunk })
		if emitted != output || !strings.HasPrefix(output, "RAY_DEPLOYMENT_SETUP:") {
			t.Fatalf("missing setup event: %s", output)
		}
		var proposal map[string]any
		if err := json.Unmarshal([]byte(strings.TrimPrefix(output, "RAY_DEPLOYMENT_SETUP:")), &proposal); err != nil {
			t.Fatal(err)
		}
		if proposal["source"] != source || proposal["name"] != "app" {
			t.Fatal(proposal)
		}
	}
}
func TestChatDeploymentDoesNotEchoCredentialURL(t *testing.T) {
	output := runDetectedTool(context.Background(), "", "deploy", "app|https://user:secret@example.com/repo|0", "owner", "", nil)
	if strings.Contains(output, "secret") || strings.Contains(output, "example.com") {
		t.Fatal("credential URL echoed", output)
	}
}

func TestChatDeploymentCarriesOnlySupportedNonSecretSettings(t *testing.T) {
	text := `<deployment_settings>{"appDirectory":"service","startCommand":"python -m app","dockerEnabled":false,"projectUrl":"https://app.example.com","envVars":{"TOKEN":"not-for-chat"},"securityOverride":"no"}</deployment_settings>`
	output := runDetectedTool(context.Background(), text, "deploy", "app|https://github.com/example/app|4444", "owner", "", nil)
	var proposal struct {
		Setup map[string]any `json:"setup"`
	}
	if err := json.Unmarshal([]byte(strings.TrimPrefix(output, "RAY_DEPLOYMENT_SETUP:")), &proposal); err != nil {
		t.Fatal(err)
	}
	if proposal.Setup["hostPort"] != float64(4444) || proposal.Setup["dockerEnabled"] != false || proposal.Setup["appDirectory"] != "service" {
		t.Fatal(proposal)
	}
	if strings.Contains(output, "not-for-chat") || strings.Contains(output, "securityOverride") {
		t.Fatal("unsupported secret or bypass copied")
	}
}

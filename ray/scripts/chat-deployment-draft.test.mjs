import test from "node:test";
import assert from "node:assert/strict";
import { parseChatDeploymentDraft } from "../src/lib/chat-deployment-draft.ts";

test("draft allowlist strips secrets, commands, proofs and URL credentials", () => {
  const draft = parseChatDeploymentDraft({ projectName: "api", customPort: "8080", internalPort: "3000", appDirectory: "apps/api", framework: "nextjs", dockerEnabled: false,
    projectUrl: "https://user:secret@example.com/?token=secret", envVars: { TOKEN: "secret" }, token: "secret", buildCommand: "echo secret", preparedSource: "secret" });
  assert.equal(draft.customPort, "8080");
  assert.equal(draft.appDirectory, "apps/api");
  assert.equal(draft.dockerEnabled, false);
  assert.equal(draft.projectUrl, "");
  assert.equal(JSON.stringify(draft).includes("secret"), false);
  assert.equal("envVars" in draft, false);
  assert.equal("buildCommand" in draft, false);
});
test("tampered browser drafts cannot retain traversal or invalid ports", () => {
  const draft = parseChatDeploymentDraft({ appDirectory: "../../private", customPort: "70000", internalPort: "-1", projectUrl: "https://app.example.com" });
  assert.equal(draft.appDirectory, ".");
  assert.equal(draft.customPort, "");
  assert.equal(draft.internalPort, "");
  assert.equal(draft.projectUrl, "https://app.example.com");
  assert.equal(parseChatDeploymentDraft(null), undefined);
});

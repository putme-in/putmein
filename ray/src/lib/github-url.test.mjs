import test from "node:test";
import assert from "node:assert/strict";
import { validateGithubRepoUrl } from "./github-url.ts";

test("rejects non-string and empty inputs", () => {
  assert.equal(validateGithubRepoUrl(null).valid, false);
  assert.equal(validateGithubRepoUrl("").valid, false);
  assert.equal(validateGithubRepoUrl("   ").valid, false);
  assert.equal(validateGithubRepoUrl(undefined).valid, false);
});

test("rejects malformed and arbitrary strings (like abc123)", () => {
  const res1 = validateGithubRepoUrl("abc123");
  assert.equal(res1.valid, false);
  assert.match(res1.error, /valid GitHub repository URL/i);

  const res2 = validateGithubRepoUrl("test-pipeline");
  assert.equal(res2.valid, false);

  const res3 = validateGithubRepoUrl("random_string_here");
  assert.equal(res3.valid, false);
});

test("rejects invalid characters, command injection, and whitespace", () => {
  assert.equal(validateGithubRepoUrl("https://github.com/owner/repo; rm -rf /").valid, false);
  assert.equal(validateGithubRepoUrl("https://github.com/owner/repo | cat").valid, false);
  assert.equal(validateGithubRepoUrl("https://github.com/owner/`id`").valid, false);
  assert.equal(validateGithubRepoUrl("https://github.com/owner/repo\ncat").valid, false);
  assert.equal(validateGithubRepoUrl("https://github.com/owner/ repo").valid, false);
});

test("rejects non-GitHub domains", () => {
  const res = validateGithubRepoUrl("https://gitlab.com/owner/repo");
  assert.equal(res.valid, false);
  assert.match(res.error, /unsupported repository host/i);

  const bitbucketRes = validateGithubRepoUrl("https://bitbucket.org/owner/repo");
  assert.equal(bitbucketRes.valid, false);
});

test("rejects incomplete GitHub URLs", () => {
  const rootRes = validateGithubRepoUrl("https://github.com");
  assert.equal(rootRes.valid, false);

  const ownerOnly = validateGithubRepoUrl("https://github.com/facebook");
  assert.equal(ownerOnly.valid, false);
  assert.match(ownerOnly.error, /missing repository name/i);
});

test("rejects deep file and branch URLs", () => {
  const fileRes = validateGithubRepoUrl("https://github.com/facebook/react/blob/main/README.md");
  assert.equal(fileRes.valid, false);
  assert.match(fileRes.error, /root repository URL/i);

  const treeRes = validateGithubRepoUrl("https://github.com/facebook/react/tree/v18.0.0");
  assert.equal(treeRes.valid, false);
});

test("rejects reserved GitHub system paths as owner", () => {
  const settingsRes = validateGithubRepoUrl("https://github.com/settings/profile");
  assert.equal(settingsRes.valid, false);
  assert.match(settingsRes.error, /reserved GitHub system path/i);

  const appsRes = validateGithubRepoUrl("https://github.com/apps/my-app");
  assert.equal(appsRes.valid, false);
});

test("accepts valid HTTPS GitHub repository URLs and normalizes them", () => {
  const res1 = validateGithubRepoUrl("https://github.com/facebook/react");
  assert.equal(res1.valid, true);
  assert.equal(res1.normalizedUrl, "https://github.com/facebook/react");
  assert.equal(res1.owner, "facebook");
  assert.equal(res1.repo, "react");

  const res2 = validateGithubRepoUrl("https://github.com/facebook/react.git");
  assert.equal(res2.valid, true);
  assert.equal(res2.normalizedUrl, "https://github.com/facebook/react");

  const res3 = validateGithubRepoUrl("http://github.com/torvalds/linux");
  assert.equal(res3.valid, true);
  assert.equal(res3.normalizedUrl, "https://github.com/torvalds/linux");

  const res4 = validateGithubRepoUrl("github.com/vercel/next.js");
  assert.equal(res4.valid, true);
  assert.equal(res4.normalizedUrl, "https://github.com/vercel/next.js");
});

test("accepts valid SSH GitHub repository URLs", () => {
  const res = validateGithubRepoUrl("git@github.com:facebook/react.git");
  assert.equal(res.valid, true);
  assert.equal(res.normalizedUrl, "https://github.com/facebook/react");
  assert.equal(res.owner, "facebook");
  assert.equal(res.repo, "react");
});

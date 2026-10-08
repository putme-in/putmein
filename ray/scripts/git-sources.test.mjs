import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
// Compile server-only modules with an inert marker; all network/DB dependencies are mocked.
function load(name, overrides = {}) {
  const source = fs.readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const imports = id => id === "server-only" ? {} : Object.hasOwn(overrides, id) ? overrides[id] : require(id);
  new Function("require", "module", "exports", code)(imports, module, module.exports);
  return module.exports;
}
const urls = load("git-url");
test("Git URLs reject credentials and unsafe transports, and keep repository identity scoped", () => {
  for (const url of ["file:///tmp/repo", "http://git.example/repo", "git@host:repo", "ext::sh bad", "https://user:secret@host/repo", "https://host/repo?token=secret", "https://host/repo#secret", "https://host/repo\n"]) assert.throws(() => urls.normalizeGitUrl(url));
  assert.equal(urls.normalizeGitUrl("https://git.example/team/subgroup/repo.git"), "https://git.example/team/subgroup/repo.git");
  assert.equal(urls.gitRepositoryKey("https://github.com/Owner/Repo.git"), urls.gitRepositoryKey("https://github.com/owner/repo"));
  assert.notEqual(urls.gitRepositoryKey("https://git.example/a/repo"), urls.gitRepositoryKey("https://git.example/b/repo"));
  assert.equal(urls.supportsGitHubPush("https://github.com.evil.example/a/repo"), false);
});
test("private credentials are encrypted, owner-scoped, rotated and never returned by list/save", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ray-git-test-"));
  const oldDir = process.env.RAY_GIT_CONNECTIONS_DIR, oldKey = process.env.JWT_SECRET;
  process.env.RAY_GIT_CONNECTIONS_DIR = directory; process.env.JWT_SECRET = "isolated-test-key";
  try {
    const store = load("git-connections", { "./git-url": urls });
    const input = { name: "Test", repoUrl: "https://git.example/team/app.git", username: "reader", private: true, token: "secret-test-token" };
    const saved = await store.saveGitConnection("owner-a", input);
    assert.equal(JSON.stringify(saved).includes(input.token), false);
    assert.equal(JSON.stringify(await store.listGitConnections("owner-a")).includes(input.token), false);
    const ownerDir = fs.readdirSync(directory)[0];
    const file = path.join(directory, ownerDir, `${saved.id}.json`);
    assert.equal(fs.readFileSync(file, "utf8").includes(input.token), false);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal((await store.getGitConnection("owner-a", "https://git.example/team/app")).token, input.token);
    assert.equal(await store.getGitConnection("owner-b", input.repoUrl), null);
    assert.equal(await store.getGitConnection("owner-a", "https://git.example/team/other"), null);
    await store.saveGitConnection("owner-a", { ...input, token: "rotated-token" });
    await store.saveGitConnection("owner-a", { ...input, token: "" });
    assert.equal((await store.getGitConnection("owner-a", input.repoUrl)).token, "rotated-token");
    const envelope = JSON.parse(fs.readFileSync(file)); envelope.tag = Buffer.alloc(16).toString("base64"); fs.writeFileSync(file, JSON.stringify(envelope));
    await assert.rejects(store.getGitConnection("owner-a", input.repoUrl));
    await store.deleteGitConnection("owner-a", saved.id);
    assert.equal(await store.getGitConnection("owner-a", input.repoUrl), null);
  } finally {
    if (oldDir === undefined) delete process.env.RAY_GIT_CONNECTIONS_DIR; else process.env.RAY_GIT_CONNECTIONS_DIR = oldDir;
    if (oldKey === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldKey;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("network policy rejects loopback, metadata, private and mapped IPv6 destinations", () => {
  const source = load("git-source", { "./git-url": urls, "./git-connections": {}, "./github-app": {} });
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "::ffff:127.0.0.1", "fd00::1", "2002:7f00:1::"]) assert.equal(source.publicGitAddress(address), false, address);
  for (const address of ["8.8.8.8", "2606:4700:4700::1111"]) assert.equal(source.publicGitAddress(address), true, address);
});
test("checkout scopes auth in environment and does not inherit Git traces, helpers or server secrets", async () => {
  const { promisify } = await import("node:util");
  const calls = [];
  const execFile = () => {};
  execFile[promisify.custom] = async (command, args, options) => {
    calls.push({ command, args, env: { ...options.env } });
    if (args[0] === "help") return { stdout: "http.curloptResolve\n" };
    if (args[0] === "ls-remote") return { stdout: "ref: refs/heads/main\tHEAD\n" };
    if (args.includes("rev-parse")) return { stdout: "a".repeat(40) };
    return { stdout: "metadata" };
  };
  const old = process.env.BRAIN_INTERNAL_SECRET;
  process.env.BRAIN_INTERNAL_SECRET = "must-not-be-inherited";
  try {
    const source = load("git-source", {
      "child_process": { execFile }, "dns/promises": { lookup: async () => [{ address: "8.8.8.8", family: 4 }] },
      "./git-url": urls, "./git-connections": { getGitConnection: async () => ({ private: true, username: "reader", token: "test-secret" }) },
      "./github-app": { getEffectiveGitHubToken: async () => { throw new Error("Unexpected GitHub fallback"); } },
    });
    const result = await source.cloneGitSource("owner", "https://git.example/team/app.git", "", "/unused-test-destination");
    assert.equal(result.branch, "main");
    const clone = calls.find(call => call.args[0] === "clone");
    assert.equal(clone.env.BRAIN_INTERNAL_SECRET, undefined);
    assert.equal(clone.env.GIT_TRACE, undefined);
    assert.equal(clone.env.GIT_CONFIG_NOSYSTEM, "1");
    assert.equal(clone.env.GIT_ALLOW_PROTOCOL, "https");
    assert.equal(JSON.stringify(clone.args).includes("test-secret"), false);
    const entries = Array.from({ length: Number(clone.env.GIT_CONFIG_COUNT) }, (_, i) => [clone.env[`GIT_CONFIG_KEY_${i}`], clone.env[`GIT_CONFIG_VALUE_${i}`]]);
    assert.deepEqual(entries.find(([key]) => key.endsWith(".extraheader")), ["http.https://git.example/team/app.git.extraheader", `Authorization: Basic ${Buffer.from("reader:test-secret").toString("base64")}`]);
    assert.deepEqual(entries.find(([key]) => key === "http.curloptResolve"), ["http.curloptResolve", "git.example:443:8.8.8.8"]);
    assert.deepEqual(entries.find(([key]) => key === "http.followRedirects"), ["http.followRedirects", "false"]);
  } finally { if (old === undefined) delete process.env.BRAIN_INTERNAL_SECRET; else process.env.BRAIN_INTERNAL_SECRET = old; }
});

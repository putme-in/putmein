const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");

test("bin/brain is not present in root bin/ and not tracked by git", () => {
  const rootBinBrain = path.join(ROOT_DIR, "bin", "brain");
  assert.equal(
    fs.existsSync(rootBinBrain),
    false,
    "bin/brain binary should not exist in root bin directory"
  );

  let tracked = "";
  try {
    tracked = execSync("git ls-files bin/brain", { cwd: ROOT_DIR, encoding: "utf-8" }).trim();
  } catch (_) {}
  assert.equal(tracked, "", "bin/brain must not be tracked in git index");
});

test(".gitignore ignores /bin/brain and /bin/brain.exe", () => {
  const gitignore = fs.readFileSync(path.join(ROOT_DIR, ".gitignore"), "utf-8");
  assert.match(gitignore, /\/bin\/brain\b/);
  assert.match(gitignore, /\/bin\/brain\.exe\b/);
});

test("ecosystem.config.js does not fall back to root bin/brain", () => {
  const ecosystemCode = fs.readFileSync(path.join(ROOT_DIR, "ecosystem.config.js"), "utf-8");
  assert.doesNotMatch(
    ecosystemCode,
    /path\.join\(__dirname,\s*["']bin["'],\s*brainBinaryName\)/,
    "ecosystem.config.js must not contain a fallback candidate to root bin/brain"
  );
});

test("scripts/build-dist.js enforces Go preflight check and exits on missing compiler", () => {
  const buildDistCode = fs.readFileSync(path.join(ROOT_DIR, "scripts", "build-dist.js"), "utf-8");
  assert.match(
    buildDistCode,
    /go\s+version/,
    "build-dist.js must verify Go compiler presence"
  );
  assert.match(
    buildDistCode,
    /Go compiler \('go'\) was not found/,
    "build-dist.js must provide an actionable error when Go is missing"
  );
});

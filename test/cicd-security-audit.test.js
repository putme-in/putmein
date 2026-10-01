const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");

test("ray/src/lib/cicd-runner.ts configures timeout and auth headers for security scan", () => {
  const runnerCode = fs.readFileSync(path.join(ROOT_DIR, "ray", "src", "lib", "cicd-runner.ts"), "utf-8");

  assert.match(
    runnerCode,
    /fetch\(`\$\{BRAIN_URL\}\/v1\/security\/scan`[\s\S]*?signal:\s*AbortSignal\.timeout\(\d+\)/,
    "cicd-runner.ts must pass a timeout signal to /v1/security/scan"
  );

  assert.match(
    runnerCode,
    /fetch\(`\$\{BRAIN_URL\}\/v1\/security\/scan`[\s\S]*?x-brain-secret/,
    "cicd-runner.ts must send x-brain-secret header to /v1/security/scan"
  );
});

test("ray/src/lib/cicd-runner.ts handles non-2xx HTTP responses with failure and error logging", () => {
  const runnerCode = fs.readFileSync(path.join(ROOT_DIR, "ray", "src", "lib", "cicd-runner.ts"), "utf-8");

  assert.match(
    runnerCode,
    /const errText = await secRes\.text\(\)/,
    "cicd-runner.ts must read the error text from non-2xx security scan responses"
  );

  assert.match(
    runnerCode,
    /stages\[2\]\.status\s*=\s*["']failed["']/,
    "cicd-runner.ts must mark the Security Audit stage (stages[2]) as failed when scan fails"
  );

  assert.match(
    runnerCode,
    /\[SECURITY ERROR\] Security audit scan failed/,
    "cicd-runner.ts must log [SECURITY ERROR] with the HTTP status and error text"
  );
});

test("ray/src/lib/cicd-runner.ts handles timeout and network errors with clear security errors", () => {
  const runnerCode = fs.readFileSync(path.join(ROOT_DIR, "ray", "src", "lib", "cicd-runner.ts"), "utf-8");

  assert.match(
    runnerCode,
    /secErr\?\.name === ["']AbortError["']\s*\|\|\s*secErr\?\.name === ["']TimeoutError["']/,
    "cicd-runner.ts must detect AbortError/TimeoutError on security audit requests"
  );

  assert.match(
    runnerCode,
    /Security audit request timed out after \d+ seconds/,
    "cicd-runner.ts must produce a descriptive timeout error message"
  );
});

test("ray/app/api/deploy/route.ts includes timeout, auth, and error logging on auto security scan", () => {
  const deployRouteCode = fs.readFileSync(path.join(ROOT_DIR, "ray", "app", "api", "deploy", "route.ts"), "utf-8");

  assert.match(
    deployRouteCode,
    /fetch\(`\$\{BRAIN_URL\}\/v1\/security\/scan`[\s\S]*?signal:\s*AbortSignal\.timeout\(\d+\)/,
    "deploy/route.ts must pass a timeout signal to /v1/security/scan"
  );

  assert.match(
    deployRouteCode,
    /fetch\(`\$\{BRAIN_URL\}\/v1\/security\/scan`[\s\S]*?x-brain-secret/,
    "deploy/route.ts must include x-brain-secret header"
  );

  assert.match(
    deployRouteCode,
    /console\.warn\(`\[Security\] Auto-scan failed with HTTP \$\{secRes\.status\}: \$\{errText\}`\)/,
    "deploy/route.ts must log warning when auto-scan responds with non-2xx status"
  );
});

test("ray/app/api/security/scan/route.ts includes timeout and auth headers", () => {
  const scanRouteCode = fs.readFileSync(path.join(ROOT_DIR, "ray", "app", "api", "security", "scan", "route.ts"), "utf-8");

  assert.match(
    scanRouteCode,
    /signal:\s*AbortSignal\.timeout\(\d+\)/,
    "security/scan/route.ts must pass timeout signal"
  );

  assert.match(
    scanRouteCode,
    /x-brain-secret/,
    "security/scan/route.ts must pass x-brain-secret header"
  );
});

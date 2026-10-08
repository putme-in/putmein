const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");

test("ray/src/lib/cicd-runner.ts handles Brain deployment security gate events and danger blocking", () => {
  const runnerCode = fs.readFileSync(path.join(ROOT_DIR, "ray", "src", "lib", "cicd-runner.ts"), "utf-8");

  assert.match(
    runnerCode,
    /ev\.step === ["']security["']/,
    "cicd-runner.ts must handle Brain security gate SSE event"
  );

  assert.match(
    runnerCode,
    /securityBlocked = ev\.securityStatus === ["']danger["']/,
    "cicd-runner.ts must block pipeline progression when security status is danger"
  );

  assert.match(
    runnerCode,
    /stages\[2\]\.status = ev\.status === ["']error["'] \? \(ev\.securityStatus === ["']danger["'] \? ["']danger["'] : ["']failed["']\)/,
    "cicd-runner.ts must update stage[2] security audit status accordingly"
  );
});

test("ray/src/lib/cicd-runner.ts passes securityOverride and internal secret to Brain deploy service", () => {
  const runnerCode = fs.readFileSync(path.join(ROOT_DIR, "ray", "src", "lib", "cicd-runner.ts"), "utf-8");

  assert.match(
    runnerCode,
    /fetch\(`\$\{BRAIN_URL\}\/v1\/deploy`[\s\S]*?x-brain-secret/,
    "cicd-runner.ts must pass x-brain-secret header to Brain deploy service"
  );

  assert.match(
    runnerCode,
    /securityOverride/,
    "cicd-runner.ts must propagate securityOverride in deployment payload"
  );
});

test("ray/app/api/deploy/route.ts proxies deployment with internal secret to Brain deploy gate", () => {
  const deployRouteCode = fs.readFileSync(path.join(ROOT_DIR, "ray", "app", "api", "deploy", "route.ts"), "utf-8");

  assert.match(
    deployRouteCode,
    /fetch\(`\$\{BRAIN_URL\}\/v1\/deploy`[\s\S]*?x-brain-secret/,
    "deploy/route.ts must include x-brain-secret header when delegating to Brain deploy"
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

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");

test("brain/internal/api/containers.go does not use Unix 2>/dev/null redirects", () => {
  const containersCode = fs.readFileSync(
    path.join(ROOT_DIR, "brain", "internal", "api", "containers.go"),
    "utf-8"
  );
  assert.doesNotMatch(
    containersCode,
    /2>\/dev\/null/,
    "containers.go must not use Unix 2>/dev/null redirection in docker commands"
  );
});

test("brain/internal/monitor/log_reader.go normalizes Unix redirects for Windows", () => {
  const logReaderCode = fs.readFileSync(
    path.join(ROOT_DIR, "brain", "internal", "monitor", "log_reader.go"),
    "utf-8"
  );
  assert.match(
    logReaderCode,
    /NormalizeCommandForOS/,
    "log_reader.go must define NormalizeCommandForOS"
  );
  assert.match(
    logReaderCode,
    /2>nul/,
    "log_reader.go must translate 2>/dev/null to 2>nul on Windows"
  );
});

test("ray/app/api/projects/[id]/route.ts does not use Unix 2>/dev/null or xargs", () => {
  const routeCode = fs.readFileSync(
    path.join(ROOT_DIR, "ray", "app", "api", "projects", "[id]", "route.ts"),
    "utf-8"
  );
  assert.doesNotMatch(
    routeCode,
    /2>\/dev\/null/,
    "projects/[id]/route.ts must not use Unix 2>/dev/null redirects"
  );
  assert.doesNotMatch(
    routeCode,
    /xargs/,
    "projects/[id]/route.ts must not rely on Unix xargs"
  );
});

test("brain/internal/deploy/docker.go defaults to official Windows Docker pipe", () => {
  const deployCode = fs.readFileSync(
    path.join(ROOT_DIR, "brain", "internal", "deploy", "docker.go"),
    "utf-8"
  );
  assert.match(
    deployCode,
    /ResolveDockerEnv/,
    "docker.go must define ResolveDockerEnv"
  );
  assert.match(
    deployCode,
    /npipe:\/\/\/\/\.\/pipe\/docker_engine/,
    "docker.go must fallback to npipe:////./pipe/docker_engine"
  );
});

test("ecosystem.config.js ensures valid DOCKER_HOST on Windows", () => {
  const ecoCode = fs.readFileSync(
    path.join(ROOT_DIR, "ecosystem.config.js"),
    "utf-8"
  );
  assert.match(
    ecoCode,
    /npipe:\/\/\/\/\.\/pipe\/docker_engine/,
    "ecosystem.config.js must set npipe:////./pipe/docker_engine on Windows"
  );
});


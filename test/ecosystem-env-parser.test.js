const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");

test("scripts/test-env-parser.js executes successfully without dotenv module resolution errors", () => {
  const scriptPath = path.join(ROOT_DIR, "scripts", "test-env-parser.js");
  assert.ok(fs.existsSync(scriptPath), "scripts/test-env-parser.js must exist");

  const output = execSync(`${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`, {
    cwd: ROOT_DIR,
    encoding: "utf-8",
  });

  assert.ok(
    output.includes("Environment parser regression passed"),
    "Expected test-env-parser.js to pass and output success message"
  );
});

test("ecosystem.config.js includes fallback resolution for dotenv when executed in isolated environments", () => {
  const ecoPath = path.join(ROOT_DIR, "ecosystem.config.js");
  const content = fs.readFileSync(ecoPath, "utf-8");

  assert.ok(
    content.includes("candidateRoots"),
    "Expected ecosystem.config.js to include candidateRoots fallback for dotenv"
  );
  assert.ok(
    content.includes("process.cwd()"),
    "Expected candidateRoots to include process.cwd() fallback"
  );
});

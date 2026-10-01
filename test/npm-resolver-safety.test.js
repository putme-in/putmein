const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");

test("ray/package.json and root package.json declare engines for node and npm", () => {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf-8"));
  assert.ok(rootPkg.engines, "root package.json must declare engines");
  assert.ok(rootPkg.engines.node, "root package.json must declare node engine");
  assert.ok(rootPkg.engines.npm, "root package.json must declare npm engine");

  const rayPkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "ray", "package.json"), "utf-8"));
  assert.ok(rayPkg.engines, "ray/package.json must declare engines");
  assert.ok(rayPkg.engines.node, "ray/package.json must declare node engine");
  assert.ok(rayPkg.engines.npm, "ray/package.json must declare npm engine");
});

test("ray/.npmrc configures legacy-peer-deps to prevent npm 11 arborist resolver crashes", () => {
  const rayNpmrcPath = path.join(ROOT_DIR, "ray", ".npmrc");
  assert.ok(fs.existsSync(rayNpmrcPath), "ray/.npmrc must exist");

  const rayNpmrcContent = fs.readFileSync(rayNpmrcPath, "utf-8");
  assert.match(
    rayNpmrcContent,
    /legacy-peer-deps\s*=\s*true/,
    "ray/.npmrc must configure legacy-peer-deps=true"
  );
});

test("README.md documents prerequisites and legacy-peer-deps workaround", () => {
  const readmeContent = fs.readFileSync(path.join(ROOT_DIR, "README.md"), "utf-8");
  assert.ok(
    readmeContent.includes("legacy-peer-deps"),
    "README.md must document legacy-peer-deps workaround"
  );
  assert.ok(
    readmeContent.includes("arborist"),
    "README.md must document the arborist resolver context"
  );
});

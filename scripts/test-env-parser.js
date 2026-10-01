const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "putmein-env-test-"));
const tempDotenvDir = path.join(tempDir, "node_modules", "dotenv");

try {
  fs.mkdirSync(path.join(tempDir, "ray"), { recursive: true });
  fs.copyFileSync(path.join(rootDir, "ecosystem.config.js"), path.join(tempDir, "ecosystem.config.js"));
  fs.writeFileSync(
    path.join(tempDir, "ray", ".env"),
    [
      'JWT_SECRET="regression-test-secret"',
      'DATABASE_URL="mysql://user:pass@localhost:3306/db?ssl=true"',
      'COMPLEX_SECRET="base64==#fragment"',
      "UNQUOTED_SECRET=token=part # inline comment",
      "SPACED_SECRET = spaced value",
      "# IGNORED_SECRET=should-not-load",
      "",
    ].join("\n"),
  );

  // Provide dotenv dependency to the temporary test environment so Node resolves it across platforms
  const rootDotenvDir = path.join(rootDir, "node_modules", "dotenv");
  const tempNodeModules = path.join(tempDir, "node_modules");
  fs.mkdirSync(tempNodeModules, { recursive: true });

  if (fs.existsSync(rootDotenvDir)) {
    try {
      const symlinkType = process.platform === "win32" ? "junction" : "dir";
      fs.symlinkSync(rootDotenvDir, tempDotenvDir, symlinkType);
    } catch (_) {
      fs.cpSync(rootDotenvDir, tempDotenvDir, { recursive: true });
    }
  }

  const child = spawnSync(
    process.execPath,
    [
      "-e",
      `const Module = require("module");
const originalResolveFilename = Module._resolveFilename;
const rootNodeModules = ${JSON.stringify(path.join(rootDir, "node_modules"))};
Module._resolveFilename = function(request, parent, isMain, options) {
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options);
  } catch (err) {
    if (err && err.code === "MODULE_NOT_FOUND") {
      try {
        return originalResolveFilename.call(this, request, {
          ...parent,
          paths: ((parent && parent.paths) || []).concat([rootNodeModules])
        }, isMain, options);
      } catch (_) {}
    }
    throw err;
  }
};
const config = require(${JSON.stringify(path.join(tempDir, "ecosystem.config.js"))});
const env = config.apps[0].env;
process.stdout.write(JSON.stringify({
  databaseUrl: env.DATABASE_URL,
  complexSecret: env.COMPLEX_SECRET,
  unquotedSecret: env.UNQUOTED_SECRET,
  spacedSecret: env.SPACED_SECRET,
  ignoredSecret: env.IGNORED_SECRET,
}));`,
    ],
    {
      cwd: tempDir,
      env: {
        ...process.env,
        NODE_PATH: [
          path.join(rootDir, "node_modules"),
          process.env.NODE_PATH || "",
        ].filter(Boolean).join(path.delimiter),
      },
      encoding: "utf8",
    },
  );

  assert.strictEqual(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.strictEqual(result.databaseUrl, "mysql://user:pass@127.0.0.1:3306/db?ssl=true&allowPublicKeyRetrieval=true");
  assert.strictEqual(result.complexSecret, "base64==#fragment");
  assert.strictEqual(result.unquotedSecret, "token=part");
  assert.strictEqual(result.spacedSecret, "spaced value");
  assert.strictEqual(result.ignoredSecret, undefined);
  console.log("Environment parser regression passed");
} finally {
  try {
    if (fs.existsSync(tempDotenvDir)) {
      const stat = fs.lstatSync(tempDotenvDir);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(tempDotenvDir);
      }
    }
  } catch (_) {}
  fs.rmSync(tempDir, { recursive: true, force: true });
}


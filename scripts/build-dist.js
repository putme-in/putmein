#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const RAY_DIR = path.join(ROOT_DIR, "ray");
const BRAIN_DIR = path.join(ROOT_DIR, "brain");
const COHEN_DIR = path.join(ROOT_DIR, "cohen");

function log(msg) {
  console.log(`\x1b[36m[BUILD]\x1b[0m ${msg}`);
}

function success(msg) {
  console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`);
}

function error(msg) {
  console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}

function dereferenceAllSymlinks(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        const targetPath = fs.realpathSync(fullPath);
        fs.unlinkSync(fullPath);
        if (fs.statSync(targetPath).isDirectory()) {
          copyDirRecursive(targetPath, fullPath);
          log(`Dereferenced symlink dir: ${entry.name}`);
        } else {
          fs.copyFileSync(targetPath, fullPath);
          log(`Dereferenced symlink file: ${entry.name}`);
        }
      } catch (err) {
        log(`Warning: Failed to dereference symlink ${entry.name}: ${err.message}`);
      }
    } else if (entry.isDirectory()) {
      dereferenceAllSymlinks(fullPath);
    }
  }
}

function findFilesRecursive(dir, predicate, results = []) {
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (predicate(entry.name, fullPath, entry)) {
      results.push(fullPath);
    }
    if (entry.isDirectory()) {
      findFilesRecursive(fullPath, predicate, results);
    }
  }
  return results;
}

function isEnvFile(name) {
  const lower = name.toLowerCase();
  return (
    lower === ".env" ||
    lower.startsWith(".env.") ||
    lower.endsWith(".env") ||
    lower.includes(".env.")
  );
}

function makeWritableRecursive(targetPath) {
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isDirectory()) {
      try {
        fs.chmodSync(targetPath, 0o777);
      } catch (_) {}
      const entries = fs.readdirSync(targetPath);
      for (const entry of entries) {
        makeWritableRecursive(path.join(targetPath, entry));
      }
    } else {
      try {
        fs.chmodSync(targetPath, 0o666);
      } catch (_) {}
    }
  } catch (_) {}
}

function safeRemoveSync(targetPath, isDirectory = false) {
  if (!fs.existsSync(targetPath)) return;
  try {
    try {
      fs.chmodSync(targetPath, isDirectory ? 0o777 : 0o666);
    } catch (_) {}
    fs.rmSync(targetPath, {
      recursive: isDirectory,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  } catch (err) {
    if (isDirectory) {
      makeWritableRecursive(targetPath);
      fs.rmSync(targetPath, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      return;
    }
    try {
      fs.chmodSync(targetPath, 0o666);
    } catch (_) {}
    fs.rmSync(targetPath, {
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}

const FORBIDDEN_DIST_RAY_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
  ".env.example",
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "README.md",
  "tsconfig.json",
  "tsconfig.tsbuildinfo",
  "eslint.config.mjs",
  "postcss.config.mjs",
  "prisma.config.ts",
  "proxy.ts",
  "package-lock.json",
];

const FORBIDDEN_DIST_RAY_DIRS = [
  "src",
  "app",
  "scripts",
];

function sanitizeDist(distDir, distRay, rootDir, logger = { log, error }) {
  logger.log("Sanitizing dist: removing all .env files and raw source code...");

  try {
    // 1. Purge specific forbidden development & source files from dist/ray
    for (const f of FORBIDDEN_DIST_RAY_FILES) {
      const p = path.join(distRay, f);
      if (fs.existsSync(p)) {
        safeRemoveSync(p, false);
      }
    }

    // 2. Purge forbidden source directories from dist/ray
    for (const d of FORBIDDEN_DIST_RAY_DIRS) {
      const p = path.join(distRay, d);
      if (fs.existsSync(p)) {
        safeRemoveSync(p, true);
      }
    }

    // 3. Purge any stray .env files anywhere across dist/ using pure Node.js recursive traversal
    const strayEnvFiles = findFilesRecursive(distDir, (name) => isEnvFile(name));
    for (const ef of strayEnvFiles) {
      const displayPath = rootDir ? path.relative(rootDir, ef) : ef;
      logger.log(`Removing forbidden env file: ${displayPath}`);
      safeRemoveSync(ef, false);
    }

    // 4. Strict Safety Assertion: Verify zero .env files exist anywhere in dist
    const remainingEnvFiles = findFilesRecursive(distDir, (name) => isEnvFile(name));
    if (remainingEnvFiles.length > 0) {
      const msg =
        "CRITICAL SECURITY ERROR: Environment files detected in dist directory after sanitization:\n" +
        remainingEnvFiles.map((p) => ` - ${rootDir ? path.relative(rootDir, p) : p}`).join("\n");
      logger.error(msg);
      throw new Error(msg);
    }

    // 5. Strict Safety Assertion: Verify forbidden directories are completely gone
    for (const d of FORBIDDEN_DIST_RAY_DIRS) {
      const p = path.join(distRay, d);
      if (fs.existsSync(p)) {
        const msg = `CRITICAL SECURITY ERROR: Forbidden directory dist/ray/${d} was not sanitized!`;
        logger.error(msg);
        throw new Error(msg);
      }
    }
  } catch (err) {
    logger.error("CRITICAL SANITIZATION FAILED: " + (err.message || err));
    throw err;
  }
}

async function main() {
  log("Starting PutmeIn full distribution build...");

  // 1. Prepare dist directory
  if (fs.existsSync(DIST_DIR)) {
    log("Cleaning previous dist directory...");
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(DIST_DIR, "brain"), { recursive: true });
  fs.mkdirSync(path.join(DIST_DIR, "ray"), { recursive: true });

  // 1.5. Pre-flight check: Verify Go compiler presence
  log("Checking for Go compiler...");
  let goVersionOutput = null;
  try {
    goVersionOutput = execSync("go version", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_) {
    goVersionOutput = null;
  }

  if (!goVersionOutput) {
    error("Go compiler ('go') was not found in system PATH.");
    error("The PutmeIn backend daemon (Brain) is written in Go and must be compiled from source.");
    error("Please install Go (1.21+ recommended) from https://go.dev/dl/ and ensure 'go' is in your PATH.");
    process.exit(1);
  }
  success(`Found Go compiler: ${goVersionOutput}`);

  // 2. Build Brain Go Binary (Multi-Architecture Cross-Compilation)
  log("Compiling Brain Go binaries for multi-platform support (Linux x64, Linux ARM64, Darwin x64/ARM64, Windows)...");
  const brainTargets = [
    { os: "linux", arch: "amd64", name: "brain-linux-x64" },
    { os: "linux", arch: "arm64", name: "brain-linux-arm64" },
    { os: "darwin", arch: "arm64", name: "brain-darwin-arm64" },
    { os: "darwin", arch: "amd64", name: "brain-darwin-x64" },
    { os: "windows", arch: "amd64", name: "brain-win32-x64.exe" },
  ];

  for (const target of brainTargets) {
    const outPath = path.join(DIST_DIR, "brain", target.name);
    try {
      execSync(`go build -ldflags="-s -w" -trimpath -o "${outPath}" .`, {
        cwd: BRAIN_DIR,
        env: { ...process.env, CGO_ENABLED: "0", GOOS: target.os, GOARCH: target.arch },
        stdio: "inherit",
      });
      fs.chmodSync(outPath, 0o755);
      success(`Brain compiled for ${target.os}/${target.arch} -> dist/brain/${target.name}`);
    } catch (err) {
      error(`Brain build failed for ${target.os}/${target.arch}: ${err.message}`);
      process.exit(1);
    }
  }

  const isWindows = process.platform === "win32";
  const brainBinaryName = isWindows ? "brain.exe" : "brain";
  const brainOutPath = path.join(DIST_DIR, "brain", brainBinaryName);
  try {
    execSync(`go build -ldflags="-s -w" -trimpath -o "${brainOutPath}" .`, {
      cwd: BRAIN_DIR,
      env: { ...process.env, CGO_ENABLED: "0" },
      stdio: "inherit",
    });
    fs.chmodSync(brainOutPath, 0o755);
    success(`Brain compiled for host native -> dist/brain/${brainBinaryName}`);
  } catch (err) {
    error(`Brain host build failed: ${err.message}`);
    process.exit(1);
  }

  // 3. Build Cohen Go Binary (if cohen directory exists)
  if (fs.existsSync(COHEN_DIR)) {
    log("Compiling Cohen Go binary (CGO_ENABLED=0)...");
    const cohenTargets = [
      { os: "linux", arch: "amd64", name: "cohen-linux-x64" },
      { os: "linux", arch: "arm64", name: "cohen-linux-arm64" },
      { os: "darwin", arch: "arm64", name: "cohen-darwin-arm64" },
      { os: "darwin", arch: "amd64", name: "cohen-darwin-x64" },
      { os: "windows", arch: "amd64", name: "cohen-win32-x64.exe" },
    ];
    const cohenOutDir = path.join(DIST_DIR, "cohen");
    fs.mkdirSync(cohenOutDir, { recursive: true });

    for (const target of cohenTargets) {
      const outPath = path.join(cohenOutDir, target.name);
      try {
        execSync(`go build -ldflags="-s -w" -trimpath -o "${outPath}" .`, {
          cwd: COHEN_DIR,
          env: { ...process.env, CGO_ENABLED: "0", GOOS: target.os, GOARCH: target.arch },
          stdio: "inherit",
        });
        fs.chmodSync(outPath, 0o755);
      } catch (err) {
        log(`Cohen compile skipped for ${target.os}/${target.arch}: ${err.message}`);
      }
    }

    const cohenBinaryName = isWindows ? "cohen.exe" : "cohen";
    const cohenOutPath = path.join(cohenOutDir, cohenBinaryName);

    try {
      execSync(`go build -ldflags="-s -w" -trimpath -o "${cohenOutPath}" .`, {
        cwd: COHEN_DIR,
        env: { ...process.env, CGO_ENABLED: "0" },
        stdio: "inherit",
      });
      fs.chmodSync(cohenOutPath, 0o755);
      success(`Cohen compiled to dist/cohen/${cohenBinaryName}`);
    } catch (err) {
      log("Cohen build skipped or encountered error: " + err.message);
    }
  }

  // 4. Build Ray Next.js Standalone
  const rayNodeModules = path.join(RAY_DIR, "node_modules");
  if (!fs.existsSync(rayNodeModules) || !fs.existsSync(path.join(rayNodeModules, "prisma"))) {
    log("Installing dependencies for Ray...");
    try {
      execSync("npm ci", { cwd: RAY_DIR, stdio: "inherit" });
    } catch (_) {
      execSync("npm install", { cwd: RAY_DIR, stdio: "inherit" });
    }
  }

  log("Generating Prisma client for Ray...");
  try {
    execSync("npx --no-install prisma generate", {
      cwd: RAY_DIR,
      stdio: "inherit",
    });
  } catch (err) {
    error("Prisma generate failed: " + err.message);
    process.exit(1);
  }

  log("Building Ray Next.js standalone bundle...");
  try {
    execSync("npm run build", {
      cwd: RAY_DIR,
      stdio: "inherit",
    });
  } catch (err) {
    error("Ray Next.js build failed: " + err.message);
    process.exit(1);
  }

  // 5. Stage Ray standalone artifacts into dist/ray
  log("Staging Ray standalone server and assets into dist/ray...");
  const standaloneSource = path.join(RAY_DIR, ".next", "standalone");
  const distRay = path.join(DIST_DIR, "ray");

  if (!fs.existsSync(standaloneSource)) {
    error("Next.js standalone directory not found at " + standaloneSource);
    process.exit(1);
  }

  // Next.js standalone outputs into .next/standalone/ray when monorepo/turbopack tracing is configured,
  // or flat in .next/standalone otherwise. Detect the actual app folder.
  const nestedRayDir = path.join(standaloneSource, "ray");
  const hasNestedRay = fs.existsSync(path.join(nestedRayDir, "server.js"));
  const actualSource = hasNestedRay ? nestedRayDir : standaloneSource;

  log(`Staging standalone application from ${path.relative(ROOT_DIR, actualSource)} directly into dist/ray...`);
  copyDirRecursive(actualSource, distRay);

  // If there's an outer node_modules in standalone (e.g. hoisted dependencies), copy it into dist/ray/node_modules
  const outerNodeModules = path.join(standaloneSource, "node_modules");
  if (hasNestedRay && fs.existsSync(outerNodeModules)) {
    log("Staging hoisted node_modules from .next/standalone/node_modules...");
    copyDirRecursive(outerNodeModules, path.join(distRay, "node_modules"));
  }

  // Defensive cleanup: Ensure no stray nested dist/ray/ray directory was created
  const strayNestedRay = path.join(distRay, "ray");
  if (fs.existsSync(strayNestedRay)) {
    log("Cleaning accidental nested dist/ray/ray directory...");
    fs.rmSync(strayNestedRay, { recursive: true, force: true });
  }

  // Ensure full @prisma and .prisma runtime directories are staged in both node_modules and .next/node_modules
  const sourcePrisma = path.join(RAY_DIR, "node_modules", "@prisma");
  const destPrisma = path.join(distRay, "node_modules", "@prisma");
  if (fs.existsSync(sourcePrisma)) {
    log("Ensuring complete @prisma runtime is staged in node_modules/@prisma...");
    copyDirRecursive(sourcePrisma, destPrisma);
  }

  const destPrismaNext = path.join(distRay, ".next", "node_modules", "@prisma");
  if (fs.existsSync(sourcePrisma)) {
    log("Ensuring complete @prisma runtime is staged in .next/node_modules/@prisma...");
    copyDirRecursive(sourcePrisma, destPrismaNext);
  }

  const sourceDotPrisma = path.join(RAY_DIR, "node_modules", ".prisma");
  const destDotPrisma = path.join(distRay, "node_modules", ".prisma");
  if (fs.existsSync(sourceDotPrisma)) {
    log("Ensuring complete .prisma client and query engines are staged in node_modules/.prisma...");
    copyDirRecursive(sourceDotPrisma, destDotPrisma);
  }

  const destDotPrismaNext = path.join(distRay, ".next", "node_modules", ".prisma");
  if (fs.existsSync(sourceDotPrisma)) {
    log("Ensuring complete .prisma client and query engines are staged in .next/node_modules/.prisma...");
    copyDirRecursive(sourceDotPrisma, destDotPrismaNext);
  }

  // Dereference ALL symlinks in distRay so packages are 100% self-contained on Linux and Windows
  log("Dereferencing all symlinks in dist/ray...");
  dereferenceAllSymlinks(distRay);

  // Ensure schema.prisma is staged for runtime migrations and prisma db push
  const sourcePrismaDir = path.join(RAY_DIR, "prisma");
  const destPrismaDir = path.join(distRay, "prisma");
  if (fs.existsSync(sourcePrismaDir)) {
    log("Staging schema.prisma into dist/ray/prisma...");
    copyDirRecursive(sourcePrismaDir, destPrismaDir);
  }

  // Stage init-db.sql into dist
  const initDbSqlPath = path.join(ROOT_DIR, "bin", "init-db.sql");
  if (fs.existsSync(initDbSqlPath)) {
    fs.copyFileSync(initDbSqlPath, path.join(DIST_DIR, "init-db.sql"));
    log("Staged init-db.sql into dist/init-db.sql");
  }

  // Next.js standalone docs require copying static files and public directory
  const rayStatic = path.join(RAY_DIR, ".next", "static");
  const destStatic = path.join(distRay, ".next", "static");
  if (fs.existsSync(rayStatic)) {
    log("Copying Next.js static assets...");
    copyDirRecursive(rayStatic, destStatic);
  }

  const rayPublic = path.join(RAY_DIR, "public");
  const destPublic = path.join(distRay, "public");
  if (fs.existsSync(rayPublic)) {
    log("Copying public assets...");
    copyDirRecursive(rayPublic, destPublic);
  }

  // Prepend environment loader to dist/ray/server.js so standalone Next.js always has DATABASE_URL & JWT_SECRET
  const distServerJs = path.join(distRay, "server.js");
  if (fs.existsSync(distServerJs)) {
    const originalServerCode = fs.readFileSync(distServerJs, "utf-8");
    const envBootstrapCode = `// PutmeIn standalone runtime environment loader
(function() {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const crypto = require('crypto');
  if (!process.env.DATABASE_URL) {
    const candidates = [
      path.join(__dirname, '..', '..', 'ray', '.env'),
      path.join(__dirname, '..', '..', '.env'),
      path.join(process.cwd(), '.env'),
      path.join(os.homedir(), '.putmein', '.env'),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, 'utf-8');
          for (const line of content.split('\\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
              const idx = trimmed.indexOf('=');
              const k = trimmed.slice(0, idx).trim();
              const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
              if (!process.env[k]) process.env[k] = v;
            }
          }
        }
      } catch (_) {}
    }
  }
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "mysql://root:root@127.0.0.1:3306/putmein?allowPublicKeyRetrieval=true";
  } else {
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace("@localhost:", "@127.0.0.1:");
    if (!process.env.DATABASE_URL.includes("allowPublicKeyRetrieval")) {
      process.env.DATABASE_URL += (process.env.DATABASE_URL.includes("?") ? "&" : "?") + "allowPublicKeyRetrieval=true";
    }
  }

  const insecureJwtDefaults = [
    'putmein-jwt-secret-default-key-2024',
    'fallback-secret-for-dev-only',
    'secret',
    'test',
    'dev',
    '123456',
    'password',
    'default'
  ];
  const activeJwt = (process.env.JWT_SECRET || '').trim();
  if (!activeJwt || insecureJwtDefaults.includes(activeJwt)) {
    const generated = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET = generated;
    try {
      const cfgDir = path.join(os.homedir(), '.putmein');
      const cfgFile = path.join(cfgDir, '.env');
      if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });
      let cfgContent = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, 'utf-8') : '';
      if (/^JWT_SECRET=/m.test(cfgContent)) {
        cfgContent = cfgContent.replace(/^JWT_SECRET=.*$/m, 'JWT_SECRET="' + generated + '"');
      } else {
        cfgContent = (cfgContent.trim() ? cfgContent.trim() + '\\n' : '') + 'JWT_SECRET="' + generated + '"\\n';
      }
      fs.writeFileSync(cfgFile, cfgContent, { mode: 0o600 });
    } catch (_) {}
  }
})();
`;
    fs.writeFileSync(distServerJs, envBootstrapCode + originalServerCode, "utf-8");
    log("Injected environment bootstrapper into dist/ray/server.js");
  }

  // 6. Security & Cleanliness Sanitization: Purge ALL secrets, .env files, and raw source code from dist/
  try {
    sanitizeDist(DIST_DIR, distRay, ROOT_DIR, { log, error });
  } catch (err) {
    error("Build halted: Environment file sanitization failed! " + (err.message || err));
    process.exit(1);
  }

  // 7. Post-build Verification Assertions
  log("Validating production distribution integrity...");
  if (!fs.existsSync(distServerJs)) {
    error("POST-BUILD VALIDATION FAILED: dist/ray/server.js does not exist!");
    process.exit(1);
  }

  const hostBrainBinary = path.join(DIST_DIR, "brain", brainBinaryName);
  if (!fs.existsSync(hostBrainBinary) || fs.statSync(hostBrainBinary).size === 0) {
    error(`POST-BUILD VALIDATION FAILED: Host Brain binary ${brainBinaryName} does not exist in dist/brain/ or is empty!`);
    process.exit(1);
  }

  if (fs.existsSync(path.join(distRay, "ray"))) {
    error("POST-BUILD VALIDATION FAILED: Nested dist/ray/ray directory exists!");
    process.exit(1);
  }

  if (!fs.existsSync(path.join(distRay, ".next", "static"))) {
    error("POST-BUILD VALIDATION FAILED: dist/ray/.next/static does not exist!");
    process.exit(1);
  }

  if (fs.existsSync(path.join(distRay, "src"))) {
    error("POST-BUILD VALIDATION FAILED: dist/ray/src source directory was not sanitized!");
    process.exit(1);
  }

  if (fs.existsSync(path.join(distRay, "app"))) {
    error("POST-BUILD VALIDATION FAILED: dist/ray/app source directory was not sanitized!");
    process.exit(1);
  }

  success("Post-build validation passed: dist/ray/server.js and assets are staged cleanly!");
  success("Sanitization complete: zero .env files or raw source code in dist!");
  success("Ray Next.js standalone assets staged cleanly in dist/ray!");
  success("Full PutmeIn distribution build completed successfully!");
}

if (require.main === module) {
  main().catch((err) => {
    error("Build pipeline encountered an unexpected error: " + err);
    process.exit(1);
  });
}

module.exports = {
  isEnvFile,
  safeRemoveSync,
  makeWritableRecursive,
  findFilesRecursive,
  sanitizeDist,
  FORBIDDEN_DIST_RAY_FILES,
  FORBIDDEN_DIST_RAY_DIRS,
};

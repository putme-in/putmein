#!/usr/bin/env node

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT_DIR = path.resolve(__dirname, "..");
const BRAIN_DIR = path.join(ROOT_DIR, "brain");
const isWindows = process.platform === "win32";

// ---------------------------------------------------------------------------
// 1. Linux & macOS (POSIX) execution:
// Preserves the exact original behavior: CGO_ENABLED=0 go build -o bin/brain .
// ---------------------------------------------------------------------------
if (!isWindows) {
  console.log(`\x1b[36m[BUILD:BRAIN]\x1b[0m Building Brain for Unix (Linux/macOS)...`);
  try {
    const binDir = path.join(BRAIN_DIR, "bin");
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    execSync("CGO_ENABLED=0 go build -o bin/brain .", {
      cwd: BRAIN_DIR,
      stdio: "inherit",
      shell: true,
    });

    try {
      fs.chmodSync(path.join(binDir, "brain"), 0o755);
    } catch (_) {}

    console.log(`\x1b[32m[SUCCESS]\x1b[0m Brain successfully compiled -> brain/bin/brain`);
    process.exit(0);
  } catch (err) {
    console.error(`\x1b[31m[ERROR]\x1b[0m Unix build failed: ${err.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 2. Windows execution:
// Resolves Go path, passes CGO_ENABLED=0 via env object, outputs brain.exe
// ---------------------------------------------------------------------------
console.log(`\x1b[36m[BUILD:BRAIN]\x1b[0m Building Brain for Windows...`);

const binDir = path.join(BRAIN_DIR, "bin");
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

const outBinary = path.join(binDir, "brain.exe");

function getGoCommand() {
  try {
    execSync("go version", { stdio: "ignore" });
    return "go";
  } catch (_) {}

  const candidatePaths = [
    "C:\\Program Files\\Go\\bin\\go.exe",
    "C:\\Go\\bin\\go.exe",
    path.join(process.env.USERPROFILE || "", "go", "bin", "go.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Go", "bin", "go.exe"),
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return `"${p}"`;
    }
  }
  return "go";
}

const goCmd = getGoCommand();

try {
  execSync(`${goCmd} build -o "${outBinary}" .`, {
    cwd: BRAIN_DIR,
    env: { ...process.env, CGO_ENABLED: "0" },
    stdio: "inherit",
  });

  console.log(`\x1b[32m[SUCCESS]\x1b[0m Brain successfully compiled -> brain/bin/brain.exe`);
} catch (err) {
  console.error(`\x1b[31m[ERROR]\x1b[0m Windows build failed: ${err.message}`);
  process.exit(1);
}

const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
let dotenv;
try {
  dotenv = require("dotenv");
} catch (_) {
  // If dotenv cannot be resolved via standard lookup (e.g. executed from an isolated directory),
  // attempt to locate it from candidate project roots or parent directories
  const candidateRoots = [
    __dirname,
    path.join(__dirname, ".."),
    process.cwd(),
    path.join(process.cwd(), ".."),
  ];
  for (const root of candidateRoots) {
    const candidate = path.join(root, "node_modules", "dotenv");
    if (fs.existsSync(candidate)) {
      try {
        dotenv = require(candidate);
        break;
      } catch (__) {}
    }
  }
  if (!dotenv) {
    throw _;
  }
}

// Validate Node.js runtime version
const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < 20) {
  console.error(
    `\x1b[31m[ERROR]\x1b[0m Incompatible Node.js runtime (${process.version}).\n` +
    `PutmeIn requires Node.js >= 20.0.0 (Next.js 16 & MariaDB driver requirement).\n` +
    `Please upgrade Node.js on this system before launching daemon services.\n`
  );
}

// Load configuration from all possible env locations in priority order
let userEnv = {};

const envCandidates = [
  path.join(__dirname, "ray", ".env"),
  path.join(__dirname, ".env"),
  path.join(os.homedir(), ".putmein", ".env"),
  path.join(__dirname, "..", ".env"),
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    const parsedEnv = dotenv.parse(fs.readFileSync(envPath, "utf-8"));
    for (const [key, value] of Object.entries(parsedEnv)) {
      if (userEnv[key] === undefined) {
        userEnv[key] = value;
      }
    }
  }
}

// Ensure DATABASE_URL is never undefined and configured for MySQL 8.0
if (!userEnv.DATABASE_URL) {
  userEnv.DATABASE_URL = process.env.DATABASE_URL || "mysql://root:root@127.0.0.1:3306/putmein";
}
userEnv.DATABASE_URL = userEnv.DATABASE_URL.replace("@localhost:", "@127.0.0.1:");
if (!userEnv.DATABASE_URL.includes("allowPublicKeyRetrieval")) {
  userEnv.DATABASE_URL += (userEnv.DATABASE_URL.includes("?") ? "&" : "?") + "allowPublicKeyRetrieval=true";
}

// Ensure valid Docker named pipe on Windows if unset or pointing to obsolete pipe
if (process.platform === "win32") {
  const activeDockerHost = (userEnv.DOCKER_HOST || process.env.DOCKER_HOST || "").trim();
  if (!activeDockerHost || activeDockerHost.includes("dockerDesktopLinuxEngine")) {
    userEnv.DOCKER_HOST = "npipe:////./pipe/docker_engine";
  }
}

// Ensure JWT_SECRET is cryptographically secure and never undefined or using weak defaults
const INSECURE_JWT_DEFAULTS = [
  "putmein-jwt-secret-default-key-2024",
  "fallback-secret-for-dev-only",
  "secret",
  "test",
  "dev",
  "123456",
  "password",
  "default",
];

const activeJwtSecret = (userEnv.JWT_SECRET || process.env.JWT_SECRET || "").trim();
if (!activeJwtSecret || INSECURE_JWT_DEFAULTS.includes(activeJwtSecret)) {
  const generatedSecret = crypto.randomBytes(32).toString("hex");
  userEnv.JWT_SECRET = generatedSecret;
  process.env.JWT_SECRET = generatedSecret;

  // Persist to ~/.putmein/.env so sessions remain valid across restarts
  try {
    const globalConfigDir = path.join(os.homedir(), ".putmein");
    const globalEnvFile = path.join(globalConfigDir, ".env");
    if (!fs.existsSync(globalConfigDir)) {
      fs.mkdirSync(globalConfigDir, { recursive: true });
    }
    let existingEnv = "";
    if (fs.existsSync(globalEnvFile)) {
      existingEnv = fs.readFileSync(globalEnvFile, "utf-8");
    }
    if (/^JWT_SECRET=/m.test(existingEnv)) {
      existingEnv = existingEnv.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET="${generatedSecret}"`);
    } else {
      existingEnv = existingEnv.trim() ? `${existingEnv.trim()}\nJWT_SECRET="${generatedSecret}"\n` : `JWT_SECRET="${generatedSecret}"\n`;
    }
    fs.writeFileSync(globalEnvFile, existingEnv, { mode: 0o600 });
  } catch (_) {
    // Non-fatal if environment is read-only; in-memory secret will still secure the session
  }
}

// Resolve paths for Brain binary
const isWindows = process.platform === "win32";
const brainBinaryName = isWindows ? "brain.exe" : "brain";
const archMap = { x64: "x64", arm64: "arm64" };
const normArch = archMap[process.arch] || process.arch;

const candidateBrainPaths = [
  path.join(__dirname, "dist", "brain", `brain-${process.platform}-${normArch}${isWindows ? ".exe" : ""}`),
  path.join(__dirname, "dist", "brain", brainBinaryName),
  path.join(__dirname, "brain", "bin", brainBinaryName),
];

const brainScript = candidateBrainPaths.find((p) => fs.existsSync(p)) || candidateBrainPaths[0];

if (!fs.existsSync(brainScript)) {
  console.error(
    `\x1b[31m[ERROR]\x1b[0m PutmeIn Brain binary not found at:\n  ${brainScript}\n` +
    `Please ensure the project has been built using: npm run build\n`
  );
}

if (fs.existsSync(brainScript) && !isWindows) {
  try {
    fs.chmodSync(brainScript, 0o755);
  } catch (_) {}
}

// Resolve paths for Ray Next.js standalone server
const candidateRayPaths = [
  path.join(__dirname, "dist", "ray", "server.js"),
  path.join(__dirname, "dist", "ray", "ray", "server.js"),
  path.join(__dirname, "ray", ".next", "standalone", "ray", "server.js"),
  path.join(__dirname, "ray", ".next", "standalone", "server.js"),
];

const rayScript = candidateRayPaths.find((p) => fs.existsSync(p)) || candidateRayPaths[0];
const rayCwd = path.dirname(rayScript);

if (!fs.existsSync(rayScript)) {
  console.error(
    `\x1b[31m[ERROR]\x1b[0m PutmeIn Ray server entrypoint not found at:\n  ${rayScript}\n` +
    `Please ensure the project has been built using: npm run build\n`
  );
}

const rayPort = process.env.RAY_PORT || userEnv.RAY_PORT || "4567";
const brainPort = process.env.BRAIN_PORT || userEnv.BRAIN_PORT || "4500";
const brainSecret = process.env.BRAIN_INTERNAL_SECRET || userEnv.BRAIN_INTERNAL_SECRET || ("putmein-sec-" + crypto.randomBytes(16).toString("hex"));

module.exports = {
  apps: [
    {
      name: "putmein-brain",
      script: brainScript,
      cwd: path.dirname(brainScript),
      interpreter: "none",
      exec_mode: "fork",
      windowsHide: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      env: {
        ...userEnv,
        BRAIN_PORT: brainPort,
        RAY_URL: `http://localhost:${rayPort}`,
        BRAIN_INTERNAL_SECRET: brainSecret,
        AGENT_AUTONOMOUS: userEnv.AGENT_AUTONOMOUS || "false",
      },
    },
    {
      name: "putmein-ray",
      script: rayScript,
      cwd: rayCwd,
      windowsHide: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      env: {
        ...userEnv,
        PORT: rayPort,
        NODE_ENV: "production",
        RAY_PUBLIC_URL: userEnv.RAY_PUBLIC_URL || `http://localhost:${rayPort}`,
        BRAIN_URL: `http://localhost:${brainPort}`,
        NEXT_PUBLIC_BRAIN_URL: `http://localhost:${brainPort}`,
        BRAIN_INTERNAL_SECRET: brainSecret,
      },
    },
  ],
};

#!/usr/bin/env node

const { execSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { resolveSpawnCommand } = require("./spawn-command");

const ROOT_DIR = path.resolve(__dirname, "..");
const ECOSYSTEM_PATH = path.join(ROOT_DIR, "ecosystem.config.js");
const PKG_PATH = path.join(ROOT_DIR, "package.json");

// Read version
let version = "1.0.0";
try {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf-8"));
  version = pkg.version || version;
} catch (_) {}

// Color formatting
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
};

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === "IPv4" && !net.internal && !net.address.startsWith("127.")) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

function getPm2Command() {
  try {
    execSync("pm2 -v", { stdio: "ignore" });
    return "pm2";
  } catch (_) {}
  try {
    execSync("npx pm2 -v", { stdio: "ignore" });
    return "npx pm2";
  } catch (_) {}
  return null;
}

function waitForPort(port, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const req = http.get(`http://127.0.0.1:${port}`, () => {
        clearInterval(interval);
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          resolve(false);
        }
      });
      req.end();
    }, 500);
  });
}

function printBoxLine(content, innerWidth = 66) {
  // Strip ANSI color sequences to calculate visible length
  const stripped = content.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
  const pad = Math.max(0, innerWidth - stripped.length);
  console.log(`${C.bold}${C.cyan}│${C.reset}  ${content}${" ".repeat(pad)}  ${C.bold}${C.cyan}│${C.reset}`);
}

function printBanner(rayPort = 4567, brainPort = 4500) {
  const lanIp = getLanIp();
  const border = "─".repeat(70);

  console.log(`\n${C.bold}${C.cyan}╭${border}╮${C.reset}`);
  printBoxLine("");
  printBoxLine(`${C.bold}${C.green}[OK] PutmeIn successfully installed and running!${C.reset} (v${version})`);
  printBoxLine("");
  printBoxLine(`${C.bold}Web Dashboard (Ray):${C.reset}    ${C.cyan}http://localhost:${rayPort}${C.reset}`);
  printBoxLine(`${C.bold}Network Dashboard:${C.reset}      ${C.cyan}http://${lanIp}:${rayPort}${C.reset}`);
  printBoxLine(`${C.bold}AI Backend (Brain):${C.reset}     ${C.dim}http://localhost:${brainPort}${C.reset}`);
  printBoxLine("");
  printBoxLine(`${C.bold}First-Time Setup:${C.reset}`);
  printBoxLine(`  * Open Web Dashboard to configure your admin account`);
  printBoxLine("");
  printBoxLine(`${C.bold}Useful CLI Commands:${C.reset}`);
  printBoxLine(`  * ${C.yellow}ray status${C.reset}        Inspect service health and memory`);
  printBoxLine(`  * ${C.yellow}ray logs${C.reset}          Stream live combined logs`);
  printBoxLine(`  * ${C.yellow}ray stop${C.reset}          Stop background services`);
  printBoxLine(`  * ${C.yellow}ray restart${C.reset}       Restart services with fresh state`);
  printBoxLine(`  * ${C.yellow}ray starter${C.reset}       Enable automatic startup on system boot`);
  printBoxLine(`  * ${C.yellow}ray --no-startup${C.reset}  Disable automatic startup on boot`);
  printBoxLine(`  * ${C.yellow}ray cohen${C.reset}         Launch interactive terminal TUI`);
  printBoxLine("");
  console.log(`${C.bold}${C.cyan}╰${border}╯${C.reset}\n`);
}

function validateNodeVersion() {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major < 20) {
    console.error(
      `\n${C.red}${C.bold}[ERROR] Incompatible Node.js version (${process.version})${C.reset}\n` +
      `PutmeIn requires ${C.yellow}Node.js >= 20.0.0${C.reset} (Next.js 16 & MariaDB connector requirement).\n` +
      `Running on Node.js ${process.version} causes MariaDB and Next.js services to crash.\n\n` +
      `Please upgrade Node.js on this machine:\n` +
      `  • NVM:           ${C.cyan}nvm install 20 && nvm use 20 && nvm alias default 20${C.reset}\n` +
      `  • Ubuntu/Debian: ${C.cyan}curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt-get install -y nodejs${C.reset}\n`
    );
    process.exit(1);
  }
}

function handleStart() {
  validateNodeVersion();
  const pm2 = getPm2Command();
  if (!pm2) {
    console.error(`${C.red}[ERROR]${C.reset} PM2 is required to run PutmeIn as a daemon.`);
    console.log(`Please install it globally using: ${C.yellow}npm install -g pm2${C.reset}`);
    process.exit(1);
  }

  console.log(`${C.cyan}➜ Starting PutmeIn services (Ray & Brain) with PM2...${C.reset}`);
  try {
    try {
      execSync(`${pm2} delete putmein-ray putmein-brain`, { stdio: "ignore" });
    } catch (_) {}
    execSync(`${pm2} start "${ECOSYSTEM_PATH}"`, { stdio: "inherit" });
    execSync(`${pm2} save`, { stdio: "ignore" });
    printBanner();
  } catch (err) {
    // Attempt recovery from corrupted PM2 daemon
    try {
      console.log(`${C.yellow}Refreshing PM2 daemon state...${C.reset}`);
      execSync(`${pm2} kill`, { stdio: "ignore" });
      execSync(`${pm2} start "${ECOSYSTEM_PATH}"`, { stdio: "inherit" });
      execSync(`${pm2} save`, { stdio: "ignore" });
      printBanner();
    } catch (retryErr) {
      console.error(`${C.red}[ERROR]${C.reset} Failed to start services: ${retryErr.message}`);
      process.exit(1);
    }
  }
}

function handleStop() {
  const pm2 = getPm2Command();
  if (!pm2) return;
  console.log(`${C.cyan}➜ Stopping PutmeIn services...${C.reset}`);
  try {
    execSync(`${pm2} stop putmein-ray putmein-brain`, { stdio: "inherit" });
    console.log(`${C.green}✔ PutmeIn services stopped successfully.${C.reset}`);
  } catch (err) {
    console.log(`${C.yellow}PutmeIn services were not running.${C.reset}`);
  }
}

function handleRestart() {
  validateNodeVersion();
  const pm2 = getPm2Command();
  if (!pm2) return;
  console.log(`${C.cyan}➜ Restarting PutmeIn services...${C.reset}`);
  try {
    try {
      execSync(`${pm2} delete putmein-ray putmein-brain`, { stdio: "ignore" });
    } catch (_) {}
    execSync(`${pm2} start "${ECOSYSTEM_PATH}"`, { stdio: "inherit" });
    execSync(`${pm2} save`, { stdio: "ignore" });
    console.log(`${C.green}✔ PutmeIn services restarted successfully.${C.reset}`);
    printBanner();
  } catch (err) {
    // Attempt recovery from corrupted PM2 daemon
    try {
      console.log(`${C.yellow}Refreshing PM2 daemon state...${C.reset}`);
      execSync(`${pm2} kill`, { stdio: "ignore" });
      execSync(`${pm2} start "${ECOSYSTEM_PATH}"`, { stdio: "inherit" });
      execSync(`${pm2} save`, { stdio: "ignore" });
      console.log(`${C.green}✔ PutmeIn services restarted successfully.${C.reset}`);
      printBanner();
    } catch (retryErr) {
      console.error(`${C.red}[ERROR]${C.reset} Failed to restart services: ${retryErr.message}`);
      process.exit(1);
    }
  }
}

function handleStatus() {
  const pm2 = getPm2Command();
  if (!pm2) {
    console.log(`${C.red}PM2 is not installed.${C.reset}`);
    return;
  }

  try {
    const raw = execSync(`${pm2} jlist`, { encoding: "utf-8" });
    const list = JSON.parse(raw);
    const putmeinProcs = list.filter((p) => p.name === "putmein-ray" || p.name === "putmein-brain");

    if (putmeinProcs.length === 0) {
      console.log(`\n${C.yellow}No active PutmeIn services found in PM2.${C.reset}`);
      console.log(`Run ${C.cyan}ray start${C.reset} to launch them.\n`);
      return;
    }

    console.log(`\n${C.bold}PutmeIn Service Status:${C.reset}`);
    console.log("─".repeat(65));
    console.log(
      `${"PROCESS".padEnd(18)} ${"STATUS".padEnd(12)} ${"PID".padEnd(10)} ${"CPU".padEnd(8)} ${"MEMORY".padEnd(10)}`
    );
    console.log("─".repeat(65));

    for (const p of putmeinProcs) {
      const statusColor = p.pm2_env.status === "online" ? C.green : C.red;
      const memMb = (p.monit.memory / (1024 * 1024)).toFixed(1) + " MB";
      const cpu = (p.monit.cpu || 0) + "%";
      console.log(
        `${p.name.padEnd(18)} ${statusColor + p.pm2_env.status.padEnd(12) + C.reset} ${(p.pid + "").padEnd(10)} ${cpu.padEnd(8)} ${memMb.padEnd(10)}`
      );
    }
    console.log("─".repeat(65) + "\n");
  } catch (err) {
    execSync(`${pm2} status putmein-ray putmein-brain`, { stdio: "inherit" });
  }
}

function handleLogs() {
  const pm2 = getPm2Command();
  if (!pm2) {
    console.error(`${C.red}[ERROR]${C.reset} PM2 is required to view logs.`);
    console.log(`Please install it globally using: ${C.yellow}npm install -g pm2${C.reset}`);
    process.exit(1);
  }

  console.log(`${C.cyan}Streaming live PutmeIn logs (Ctrl+C to exit)...${C.reset}\n`);
  const parts = pm2.split(" ");
  const command = parts[0];
  const baseArgs = parts.slice(1).concat(["logs", "putmein-ray", "putmein-brain", "--lines", "50"]);
  const isWindows = process.platform === "win32";

  try {
    const child = spawn(resolveSpawnCommand(command), baseArgs, {
      stdio: "inherit",
      shell: isWindows,
    });

    child.on("error", (err) => {
      console.error(`${C.red}[ERROR]${C.reset} Failed to stream PutmeIn logs: ${err.message}`);
    });

    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  } catch (err) {
    console.error(`${C.red}[ERROR]${C.reset} Failed to stream PutmeIn logs: ${err.message}`);
  }
}

function handleStarter() {
  if (process.platform === "win32") {
    console.error(`${C.red}[ERROR]${C.reset} Automatic startup configuration is not supported on Windows by PM2.`);
    console.error(`Configure PutmeIn to launch at sign-in using Windows startup settings instead.`);
    process.exitCode = 1;
    return;
  }

  const pm2 = getPm2Command();
  if (!pm2) {
    process.exitCode = 1;
    return;
  }
  console.log(`${C.cyan}➜ Configuring PutmeIn to start automatically on system boot...${C.reset}`);
  try {
    execSync(`${pm2} startup`, { stdio: "inherit" });
    execSync(`${pm2} save`, { stdio: "inherit" });
    console.log(`\n${C.green}✔ PutmeIn will now start automatically on system boot!${C.reset}\n`);
  } catch (err) {
    console.error(`${C.red}[ERROR]${C.reset} Failed to set up startup: ${err.message}`);
    process.exitCode = 1;
  }
}

function handleNoStartup() {
  if (process.platform === "win32") {
    console.error(`${C.red}[ERROR]${C.reset} Automatic startup configuration is not supported on Windows by PM2.`);
    process.exitCode = 1;
    return;
  }

  const pm2 = getPm2Command();
  if (!pm2) {
    process.exitCode = 1;
    return;
  }
  console.log(`${C.cyan}➜ Removing PutmeIn from system boot startup...${C.reset}`);
  try {
    execSync(`${pm2} unstartup`, { stdio: "inherit" });
    console.log(`\n${C.green}✔ PutmeIn removed from system boot startup.${C.reset}\n`);
  } catch (err) {
    console.error(`${C.red}[ERROR]${C.reset} Failed to remove startup: ${err.message}`);
    process.exitCode = 1;
  }
}

function handleCohen() {
  const isWindows = process.platform === "win32";
  const binaryName = isWindows ? "cohen.exe" : "cohen";
  const candidatePaths = [
    path.join(ROOT_DIR, "dist", "cohen", binaryName),
    path.join(ROOT_DIR, "cohen", "bin", binaryName),
    path.join(ROOT_DIR, "cohen", binaryName),
  ];

  const cohenBin = candidatePaths.find((p) => fs.existsSync(p));
  if (!cohenBin) {
    console.error(`${C.red}[ERROR]${C.reset} Cohen TUI binary not found.`);
    process.exit(1);
  }

  try {
    const child = spawn(cohenBin, [], { stdio: "inherit" });
    child.on("error", (err) => {
      console.error(`${C.red}[ERROR]${C.reset} Failed to launch Cohen: ${err.message}`);
      process.exit(1);
    });
    child.on("exit", (code) => process.exit(code || 0));
  } catch (err) {
    console.error(`${C.red}[ERROR]${C.reset} Failed to launch Cohen: ${err.message}`);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
${C.bold}${C.cyan}PutmeIn CLI (ray)${C.reset} - v${version}
Autonomous DevOps & Infrastructure Orchestrator

${C.bold}USAGE:${C.reset}
  ray [command] [options]

${C.bold}COMMANDS:${C.reset}
  ${C.green}ray${C.reset}, ${C.green}ray start${C.reset}          Start PutmeIn (Ray & Brain) in the background via PM2
  ${C.green}ray stop${C.reset}, ${C.green}ray --stop${C.reset}     Stop running PutmeIn services
  ${C.green}ray restart${C.reset}           Restart PutmeIn services
  ${C.green}ray status${C.reset}, ${C.green}ray --status${C.reset}   View process status, CPU, memory, and ports
  ${C.green}ray logs${C.reset}, ${C.green}ray --logs${C.reset}       Stream live output logs from Ray and Brain
  ${C.green}ray starter${C.reset}            Configure PutmeIn to start automatically on system boot
  ${C.green}ray --no-startup${C.reset}       Disable automatic startup on boot
  ${C.green}ray cohen${C.reset}              Launch the interactive terminal TUI
  ${C.green}ray --help${C.reset}, ${C.green}-h${C.reset}          Show this help message
  ${C.green}ray --version${C.reset}, ${C.green}-v${C.reset}       Show current version
`);
}

// CLI Command routing
const args = process.argv.slice(2);
const cmd = args[0] ? args[0].toLowerCase() : "start";

switch (cmd) {
  case "start":
  case "--start":
    handleStart();
    break;
  case "stop":
  case "--stop":
    handleStop();
    break;
  case "restart":
  case "--restart":
    handleRestart();
    break;
  case "status":
  case "--status":
    handleStatus();
    break;
  case "logs":
  case "--logs":
    handleLogs();
    break;
  case "starter":
  case "--starter":
    handleStarter();
    break;
  case "no-startup":
  case "--no-startup":
    handleNoStartup();
    break;
  case "cohen":
    handleCohen();
    break;
  case "-v":
  case "--version":
    console.log(`v${version}`);
    break;
  case "-h":
  case "--help":
  case "help":
    printHelp();
    break;
  default:
    console.log(`${C.yellow}Unknown command: ${args[0]}${C.reset}`);
    printHelp();
    process.exit(1);
}

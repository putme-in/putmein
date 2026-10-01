<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/static/readme/git-cover.png">
    <img src="docs/static/readme/git-cover.png" alt="PutmeIn - Autonomous DevOps, Infrastructure Monitoring & Deployment Engine powered by Ray & Brain.">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/putme-in/putmein/actions/workflows/ci.yml"><img src="https://github.com/putme-in/putmein/actions/workflows/ci.yml/badge.svg" alt="CI Status"></a>
  <a href="https://www.npmjs.com/package/putmein"><img src="https://img.shields.io/npm/v/putmein?style=flat-square&label=npm" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License: MIT"></a>
  <a href="https://discord.gg/XX9qWbaTHQ"><img src="https://img.shields.io/discord/1548643490945048690?label=discord&logo=discord&logoColor=white&color=5865F2&style=flat-square?v" alt="Discord"></a>
</p>

# Your AI-powered Autonomous DevOps, Infrastructure Monitoring & Deployment Engine

Open source platform to Secure, Build, Fix and Deploy any project with AI. Helps in managing huge servers, docker containers, vps, kubernetes clusters, vm's and much more.

🔒 . 🏗️ . 🛠️ . 🚀

PutmeIn combines **Ray** (an interactive Next.js web console and management dashboard) with **Brain** (a high-performance Go AI background daemon and Docker orchestrator) into a unified, daemonized system manager.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/static/readme/interface.png?v">
    <img src="docs/static/readme/interface.png?v" alt="Putmein's Ray chat interface deploying God's Eye project in single message">
  </picture>
</p>

## Key Features

### Autonomous DevOps Engine (Brain)
- **Security:** Scans your code for vulnerabilities and suggests fixes. Also helps you fix the vulnerabilities in your code and in your projects
- **Conversational AI Interface:** Chat with your infrastructure using natural language.
- **Automated Deployment:** Deploy projects (Next.js, Nest.js, static sites, and more) with a single message.
- **CI/CD Pipelines:** Automatic build, test, and deployment workflows.
- **Resource Management:** Full container lifecycle management (start, stop, restart, view logs).
- **Error Resolution:** AI-powered debugging and self-healing capabilities.

### Full-Stack Dashboard (Ray)
- **Modern UI:** Beautiful, responsive interface for managing your infrastructure.
- **Live Monitoring:** Real-time metrics for CPU, RAM, disk usage, and network traffic.
- **Container Orchestration:** One-click actions for all your Docker containers.
- **Security Center:** Built-in security scanning and vulnerability detection.
- **Multi-Project Support:** Manage multiple projects and deployments from a single dashboard.

## Quick Start

### Option 1: Automatic One-Line Installation (Recommended)
```bash
# Linux / macOS / WSL
curl -fsSL https://putme.in/install.sh | bash
```

```powershell
# Windows (PowerShell)
powershell -c "irm https://putme.in/install.ps1 | iex"
```

### Option 2: Global NPM Installation
```bash
npm install -g putmein
```

Once installed, simply run:
```bash
ray
```

PutmeIn will start as a resilient background daemon via PM2 and display your local and network dashboard URLs:
* **Web Dashboard (Ray):** [http://localhost:4567](http://localhost:4567)
* **API Engine (Brain):** [http://localhost:4500](http://localhost:4500)

> **Note:** If you are running Putmein directly from the source code. The development ports are 3000 for Ray and 3100 for Brain.

---

## Useful Links
- [Website](https://putme.in)
- [Documentation](https://docs.putme.in)
- [Developer Guide](https://docs.putme.in/developer)
- [Discord](https://discord.gg/XX9qWbaTHQ)

## CLI Usage & Commands

PutmeIn exposes the `ray` command globally:

| Command | Description |
|---|---|
| `ray` or `ray start` | Starts Ray and Brain in the background via PM2 and displays dashboard URLs. |
| `ray stop` | Gracefully stops the running background services. |
| `ray restart` | Restarts all services with fresh state. |
| `ray status` | Inspects running processes, PIDs, CPU usage, memory consumption, and port status. |
| `ray logs` | Streams live unified output logs from both Ray and Brain. |
| `ray starter` | Configures PutmeIn to start automatically on system boot (`pm2 startup` & `pm2 save`). |
| `ray --no-startup` | Disables automatic startup on system boot. |
| `ray cohen` | Launches the interactive terminal TUI client. |
| `ray --help` | Displays help menu and command list. |
| `ray --version` | Prints current installed version. |

---

## Building From Source

### Prerequisites
- **Node.js**: `>=18.0.0` (v20 or v22 LTS recommended)
- **npm**: `>=9.0.0`
- **Go**: `>=1.21` (for building the Brain backend daemon)
- **Docker**: (for container management and deployments)

> **Note on npm 10.9+ / 11.x & Peer Dependencies:**
> On npm 10.9+ and npm 11.x, npm's internal dependency resolver (`arborist`) can encounter an internal null reference error (`edgesOut`) when resolving transitive peer dependency trees in `ray/`.
> The repository includes `.npmrc` files preconfigured with `legacy-peer-deps=true`. If you run manual installs or add packages in `ray/`, ensure you use:
> ```bash
> cd ray && npm install --legacy-peer-deps
> ```

```bash
# Clone the repository
git clone https://github.com/putme-in/putmein.git
cd putmein

# Install dependencies and build standalone distribution
npm install
npm run build

# Start services locally
npm start
```


---

## Testing

PutmeIn includes automated unit and integration tests across each component:

```bash
# 1. Run root CLI and installer safety tests
npm test
npm run test:installer
npm run test:env-parser

# 2. Run Ray (Next.js) unit and regression tests
cd ray && npm test

# 3. Run Brain (Go) test suite with data race detection
cd brain && go test -v -race ./...
```

---

## Contributing
If you found a bug, please create an issue with the title "Bug: " and a detailed description.

If you want to contribute to PutmeIn, check out our [Developer Guide](https://docs.putme.in/developer) for prerequisites and local setup instructions. Please fork the repository and create a pull request.

### Project Structure

- **Brain**: Backend of PutmeIn. Written in `Go`. Handles AI processing, Docker management, and core automation.
- **Ray**: Frontend of PutmeIn. Written in `Next.js`. Handles UI and user interaction.
- **Cohen**: CLI tool of PutmeIn. Written in `Node.js`. Handles CLI commands and user interaction.
- **Landing**: Landing page of PutmeIn. Written in `Next.js`. Handles landing page and user interaction.
- **Docs**: Documentation of PutmeIn. Written in `Docusaurus`. Handles documentation and user interaction.

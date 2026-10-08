---
id: index
title: Getting Started
slug: /
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<p align="center">
    <img src="readme/git-cover.png" alt="PutmeIn - Autonomous DevOps, Infrastructure Monitoring & Deployment Engine powered by Ray & Brain." />
</p>

# Host PutmeIn

You can self-host PutmeIn on your own infrastructure, on-premises servers, or cloud instances using one-line installation, the global npm package, or by building from source.

All self-hosted installations combine **Ray** (an interactive Next.js web console and management dashboard) with **Brain** (a high-performance background daemon and container orchestrator) into a unified system manager.


## Choose your installation method

Select the installation method that best fits your technical requirements and infrastructure:

<div className="doc-method-item" id="one-line-setup">
  <h3 className="doc-method-title"><svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg><span>One-line setup (Recommended)</span></h3>
  <div className="doc-method-meta">
    <p><strong>Best for:</strong> Quick automated setup with minimal configuration.</p>
    <p><strong>Requirements:</strong> macOS (Apple Silicon / Intel), Linux, or Windows (PowerShell / WSL2).</p>
    <p>Automated installation script that configures PM2 background daemons and creates runtime directories.</p>
  </div>

<Tabs groupId="operating-system">
  <TabItem value="macos" label="macOS" default>

```bash
# macOS (Apple Silicon & Intel)
curl -fsSL https://putme.in/install.sh | bash
```

  </TabItem>
  <TabItem value="linux" label="Linux">

```bash
# Linux (Ubuntu, Debian, Fedora, Arch, CentOS)
curl -fsSL https://putme.in/install.sh | bash
```

  </TabItem>
  <TabItem value="windows" label="Windows">

```powershell
# Windows (PowerShell 5.1+ / PowerShell 7)
powershell -c "irm https://putme.in/install.ps1 | iex"
```

  </TabItem>
</Tabs>
</div>

<div className="doc-method-item" id="npm-package">
  <h3 className="doc-method-title"><svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg><span>Global NPM Package</span></h3>
  <div className="doc-method-meta">
    <p><strong>Best for:</strong> Environments with existing Node.js toolchains and custom package managers.</p>
    <p><strong>Requirements:</strong> Node.js &ge; 20.0.0 and npm / pnpm / yarn.</p>
  </div>

```bash
npm install -g putmein
```
</div>

<div className="doc-method-item" id="source-build">
  <h3 className="doc-method-title"><svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg><span>Build from Source</span></h3>
  <div className="doc-method-meta">
    <p><strong>Best for:</strong> Contributors, debugging, or building standalone distribution binaries.</p>
    <p><strong>Requirements:</strong> Git, Node.js 18+, Go 1.21+.</p>
  </div>

```bash
# Clone repository and install dependencies
git clone https://github.com/putme-in/putmein.git
cd putmein

# Build standalone distribution
npm run build

# Start services locally
npm start
```
</div>

---

## Accessing the Dashboard

Once started, PutmeIn automatically spins up both core services daemonized under PM2:

| Service | Default URL | Description |
|---|---|---|
| `Ray Web Console` | `http://localhost:4567` | Telemetry, log streams, system diagnostics, and process management. |
| `Brain Engine API` | `http://localhost:4500` | Background AI daemon and Docker container orchestrator. |

> **Note:** If you are running Putmein directly from the source code. The development ports are 3000 for Ray and 3100 for Brain.

```bash
# Start background daemon services
ray start

# Inspect running process status and health
ray status

# Stream unified console logs
ray logs
```

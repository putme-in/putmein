---
id: index
title: Developer Guide
slug: /developer
---

# Developer Guide

Welcome to the PutmeIn developer guide. This section provides an architectural overview, local workflows, and contribution practices for engineers working on the PutmeIn codebase.

---

## Subpages & Guides

Navigate directly to the focused developer guides:

* [**Prerequisites**](/developer/prerequisites) — System runtimes, Node.js, npm, Go, and Docker requirements across all monorepo packages.
* [**Setting up the Project**](/developer/setup) — Step-by-step instructions for cloning, installing dependencies, configuring environments, and compiling components.

* [**Application Detection and Deployment**](./application-frameworks.md) — Framework registry, signatures, and deployment extension points.
* [**Security Rules and Scanning**](./security-rules.md) — Security file map, rule authoring, and current scan coverage.
* [**Monitoring Rules**](./monitoring-rules.md) — Application logs, deterministic alerts, and runtime error signatures.

---

## Architecture Overview

PutmeIn is structured as an integrated modular monorepo:

| Directory | Component | Technology | Role |
|---|---|---|---|
| **`/ray`** | Web Dashboard | Next.js 16 + React 19 | Interactive browser console, metrics visualization, and session management. |
| **`/brain`** | AI Engine & Daemon | Go 1.22 | Background automation daemon, Docker orchestrator, and AI action executor. |
| **`/cohen`** | Terminal UI | Go 1.22 + Bubbletea | Interactive terminal client (TUI) for direct CLI management. |
| **`/landing`** | Marketing Portal | Next.js 16 + Tailwind | Public landing and product showcase site. |
| **`/docs`** | Documentation | Docusaurus v3 | Technical manuals, API references, and user guides. |

---

## Development Workflow

### Building the Distribution

From the repository root:

```bash
npm run build
```

This triggers the build pipeline:
1. Compiles the Go binary for Brain.
2. Generates Prisma client bindings.
3. Builds the Next.js standalone application for Ray.
4. Stages the distribution into `dist/` with zero development baggage.

### Local Execution

```bash
# Start background services
npm start

# Inspect running services, CPU, and memory
node bin/ray.js status

# Stop background services
node bin/ray.js stop
```

---

## Pipeline development

- [Concurrency, Rollback & Cleanup](./deployment-lifecycle.md): lifecycle locking, recovery, retention policy and contributor file map.

- [Git Sources & Private Repositories](./git-sources.md): credential storage, source preparation and CI/CD access.
- [Project Setup](./project-setup.md): saved configuration, lifecycle, storage and extension points.

## Contributing

We welcome contributions of all kinds. When submitting pull requests:
1. Create a descriptive feature branch (`feature/your-feature-name` or `fix/issue-description`).
2. Maintain design system consistency across web interfaces.
3. Preserve existing database integrity and avoid disruptive schema modifications.
4. Submit pull requests to the `main` branch with comprehensive testing details.

* [**Templates, Health Checks and HTTPS**](./deployment-services.md) — Production assumptions, startup probes, and managed Caddy routing.

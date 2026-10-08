---
id: prerequisites
title: Prerequisites
slug: /developer/prerequisites
---

# Prerequisites

Before developing or contributing to PutmeIn, ensure your workstation meets the necessary toolchains and runtime requirements.

---

## Baseline Requirements

| Dependency | Minimum Version | Recommended | Notes |
|---|---|---|---|
| **Node.js** | `>= 20.0.0` | Node 22 (LTS) | Required across all frontend, CLI wrapper, and documentation packages. |
| **npm** | `>= 9.0.0` | Latest LTS | Standard package manager for monorepo dependency coordination. |
| **Go** | `>= 1.22` | Go 1.22+ | Required for compiling the Brain AI daemon and Cohen TUI client. |
| **Docker** | Latest stable | Docker Engine + Compose | Required for container management and local infrastructure orchestration. |
| **MySQL / MariaDB** | MySQL 8.0+ / MariaDB 10.5+ | MySQL 8.0 (Docker) | Primary relational database for Ray and internal metrics storage. |
| **Git** | `>= 2.30` | Latest | Version control and collaborative workflows. |

:::tip Operating System Compatibility
PutmeIn actively supports **macOS** (Apple Silicon and Intel), **Linux** (Debian, Ubuntu, Arch, Fedora, CentOS), and **Windows** (via native PowerShell or WSL2).
:::

---

## Toolchain Details

### 1. Node.js & npm

The monorepo contains multiple JavaScript/TypeScript packages (`ray`, `landing`, `docs`, and root scripts):

* **Recommended Version:** **Node 22 LTS** (`>= 20.0.0`).
* All packages across the repository require Node.js `>= 20.0.0` (mandated by Next.js 16 and `@prisma/adapter-mariadb`). The `landing` package is aligned with Node `22.20.0` (with `.nvmrc` set to `22`).
* To ensure seamless compilation across every package without engine mismatch warnings, installing **Node 20 or Node 22** is strongly recommended.
* Verify your installed version:
  ```bash
  node -v
  npm -v
  ```

### 2. Go

The Brain background engine (`/brain`) and the Cohen terminal user interface (`/cohen`) are implemented in Go:

* **Required Version:** **Go 1.22** or higher.
* Both `brain/go.mod` and `cohen/go.mod` require Go 1.22 language semantics.
* Verify your installed version:
  ```bash
  go version
  ```

### 3. Docker & Container Runtime

PutmeIn monitors and orchestrates Docker containers autonomously:

* Install **Docker Desktop** (macOS / Windows) or **Docker Engine with Docker Compose** (Linux).
* Ensure the Docker daemon is running and your user has permissions to access the Docker socket:
  ```bash
  docker ps
  ```

### 4. MySQL / MariaDB Database

PutmeIn uses MySQL 8.0+ as its relational data store for session auth, server configurations, deployments, and metrics:

* **Docker (Recommended):** Running MySQL via an official Docker container (`mysql:8.0`) is the fastest approach and isolates data into a named Docker volume.
* **Native:** Alternatively, install MySQL locally via Homebrew (macOS) or APT/YUM (Linux).
* See [**Local Database Setup**](/developer/setup#step-3-local-database-setup) for one-line startup commands and schema migration instructions.

---

## Next Steps

Once your prerequisites are satisfied, proceed to [**Setting up the Project**](/developer/setup) to clone the repository and configure your local workspace.

---
title: Project Setup
---

# Shared project setup

GitHub preparation, ZIP/folder upload and existing-directory registration converge on the shared setup fields. Projects also expose **Deployment setup → Edit deployment setup** for changes that should apply on the next build. Saving does not start, stop or replace the running application.

## Saved configuration

The version-1 contract in `ray/src/lib/project-setup.ts` contains the source root, relative application directory, framework override, build/start overrides, host/container ports, application URL, Docker setting and runtime environment variables. Project identity and Git branch remain in their existing database records. Automatic framework detection is the default.

| Field | Behavior |
| --- | --- |
| Application directory | Resolved inside the source root, including symlink containment. CI/CD resolves the same relative path inside each new checkout. |
| Framework | Selects a supported generated Docker template. A custom Dockerfile takes precedence; a detected/selected framework does not guarantee template coverage. |
| Build command | Overrides the generated template's build step. Custom Dockerfiles must define their own build steps. In host mode this optional command runs in a new release directory; include dependency installation when needed. Saving setup never executes commands. |
| Start command | Overrides the container entrypoint with `/bin/sh -c`. The runtime image must contain `/bin/sh`. Blank retains the image default. Required in host mode and must remain in the foreground. |
| Host/container ports | Blank permits automatic selection/detection. Docker mapping does not configure the application's listening port. Host mode sets `PORT` and has no separate internal port. |
| Application URL | Reference address in direct-port mode; managed HTTPS provisions a Caddy route after health succeeds. DNS and Caddy require operator configuration. |
| Runtime environment | Passed to container startup, or both build and start commands in host mode. Separate from source `.env` editing and Docker build arguments. |
| Docker | Enabled and recommended by default. Disable to use managed host execution on Linux/macOS. Stop the current deployment before switching runtime. |

Selecting a nested application directory uses that directory as the Docker build context. Self-contained nested applications work this way. Workspaces requiring sibling packages should use a repository-root Dockerfile that builds the desired workspace; selecting a subdirectory does not automatically include its parent or siblings.

## Lifecycle

- Initial deployment saves configuration against the monitor project's stable ID. Prepared GitHub source is verified against the signed-in user's source proof and deployed without another pull.
- CI/CD downloads a fresh checkout, resolves the selected application directory, performs its existing scan and sends that directory plus saved settings to Brain. After success, the saved source root advances to that checkout. Pipelines are linked by project ID so multiple projects may use the same repository.
- Both rebuild API routes use the saved configuration. A rebuild reuses the current source snapshot; CI/CD is the path for fetching new commits.
- Project setup edits change desired settings. Active monitor paths are updated after successful deployment. The existing domain editor updates the saved primary address, and the existing pipeline port editor updates the saved host port.
- Configured projects use the CI/CD runner for GitHub webhook updates. Repository and branch matching are explicit. Legacy standalone webhook deployments also enter the shared Brain security gate.
- Existing projects with no saved configuration receive defaults from their current project/deployment records when the editor is opened. Registration inside a Git subdirectory discovers the repository root and saves a repository-relative application directory.

## Docker-off execution

Host mode copies the selected application into the configured deployments directory under `.host-releases/<project-hash>/release-*`. Build commands run in that copy; a failed build leaves the previous release running. The old process is stopped only before launching its replacement. If startup fails, Brain attempts to restart the prior release; this is best-effort recovery, not a transactional rollback system. Persistent application data should live outside release directories.

The server must already have the required language runtime and package tools installed. For example, a Node app can use `npm ci && npm run build` and `npm start`. The application must respect `PORT`, remain in the foreground and listen on `PORT`. Startup checks now support HTTP paths/statuses or TCP connections; the default HTTP range is 200–399. Background workers without a listening port need a custom readiness endpoint. A containerized Brain runs host commands inside its own container, not on the outer machine.

Build/start commands run as Brain's OS account, **without Docker isolation**. This mode is for trusted application code. Brain provider keys, database credentials and other inherited environment values are excluded; explicit application variables are supplied. `NODE_ENV` defaults to `development` during builds and `production` at runtime unless explicitly configured. `PORT` always uses the selected port. `HOME` and `TMPDIR` default to per-project runtime directories.

A build has a ten-minute execution deadline. Deployment route/proxy budgets allow fifteen minutes; upstream reverse proxies must also support long requests. Source staging rejects special files and escaping symlinks and limits a copy to 100,000 entries / 2 GiB. `.git` is excluded. Workspaces with external symlinks must be made self-contained or deployed using Docker.

Stop, restart, cancellation, deletion and Monitor's run controls use the managed process group. Restart reuses the built release and its saved environment; rebuild applies edited setup. Brain verifies a random process marker and group identity before signaling a saved PID. It requires the standard `ps` utility and permission to inspect its own processes. Runtime state is recovered when Brain starts: surviving processes are reattached; previously active processes that have exited are restarted. Explicitly stopped/failed applications stay stopped. Unexpected exits during normal operation produce a deterministic monitoring alert rather than an automatic restart loop.

Application stdout/stderr are stored in a separate log per start, outside the source directory, and registered with Monitor. Build output is streamed and saved separately. Runtime identity uses an internal `process:` handle in the existing deployment record; it must never be passed to Docker APIs. Windows host execution is explicitly unsupported.

## Storage and operations

`ray/src/lib/project-setup-store.ts` stores setup outside application source, under `~/.ray/project-setups` by default. Set `RAY_SETUP_DIR` to an absolute persistent directory to change that location. Records are keyed by a hash of owner ID and project ID, written using atomic file replacement with mode `0600`; newly created storage directories use `0700`.

**Include this directory in server backups.** It contains runtime environment values in plaintext and should have the same restricted access as server secrets. For containerized Ray, mount it as persistent storage. Multiple Ray processes must use the same storage directory. This local store does not provide distributed write locking; concurrent saves use the last completed write. No database schema migration is required.

Deleting a project through its project API removes its setup record. Deleting only a deployment preserves project setup for later deployments. Source checkout retention remains separate work.

Brain stores host manifests, explicit application environment values and logs in `~/.ray/host-runtimes`, or `RAY_HOST_RUNTIME_DIR`. Files use mode `0600`; directories use `0700`. Back up this restricted directory and required release/data directories. Use one Brain process per runtime store; the lifecycle lock is in-process, not distributed. Log rotation and old-release pruning are not implemented. Removing a runtime deletes its manifest and logs; older staged releases require separate cleanup.

## Contributor file map

| File | Responsibility |
| --- | --- |
| `ray/src/lib/project-setup.ts` | Versioned contract, defaults, shared validation |
| `ray/src/lib/project-setup-store.ts` | Owner/project-scoped persistence, path resolution and deployment payload |
| `ray/src/components/DeploymentSetupFields.tsx` | Shared framework, command, port, URL and runtime-variable fields |
| `ray/src/components/ProjectDeploymentSettings.tsx` | Project editor with explicit load/save |
| `ray/app/api/projects/[id]/setup/route.ts` | Owner-authenticated setup read/update |
| `ray/app/api/deploy/route.ts` | Initial setup validation and deployment |
| `ray/src/lib/cicd-runner.ts` | Fresh checkout, application directory and settings propagation |
| `ray/app/api/deployments/[id]/redeploy/route.ts` | Streamed rebuild |
| `ray/app/api/deploy/[id]/action/route.ts` | Background rebuild used by project controls |
| `brain/internal/deploy/docker.go` | Runtime dispatch, framework/build overrides and container start command |
| `brain/internal/deploy/host.go` | Host lifecycle, environment, health checks, recovery and monitor registration |
| `brain/internal/deploy/host_unix.go` | Linux/macOS process groups and verified process identity |
| `brain/internal/deploy/host_unsupported.go` | Explicit unsupported-platform behavior |
| `brain/internal/deploy/host_source.go` | Isolated release copying and containment limits |
| `ray/src/lib/host-runtime.ts` | Stable runtime identity and stop-before-switch validation |
| `ray/app/api/monitor/projects/[id]/run/route.ts` | Routes host controls through the deployment lifecycle |
| `brain/internal/deploy/host_test.go` | Isolated environment, process identity, source-copy and state-storage checks |

Generated Dockerfiles carry a Ray marker so later setup edits can regenerate them. Existing unmarked Dockerfiles are treated as custom; build overrides are rejected rather than inserted into them.

## Review checklist

For manual review: configure a root project and a self-contained nested app; reopen setup and verify all values; rebuild and trigger CI/CD separately; confirm both use the selected directory, environment, ports and commands; reject `../` and symlink escapes; leave a custom Dockerfile unchanged when trying a build override; confirm saving settings alone does not restart the app; confirm a push to a different branch does not launch a configured pipeline.

For host review: disable Docker, enter build/start commands and deploy an HTTP app; inspect real logs; stop/restart it; rebuild with a failing command and confirm the previous process remains live; verify restart recovery; stop before switching back to Docker. Check Monitor controls and project deletion on a disposable project.

Verification includes TypeScript/Go compilation and focused isolated host tests for environment filtering, process identity/stop, safe source staging and manifest permissions. No real application was deployed for this stage. Production templates, configurable startup checks, and managed HTTPS are now described in [Deployment Services](./deployment-services.md). Distributed lifecycle locking and comprehensive rollback remain later work. The shared security gate is documented in [Security Rules](./security-rules.md).

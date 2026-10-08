---
id: application-frameworks
title: Application Detection and Deployment
slug: /developer/application-frameworks
---

# Application Detection and Deployment

Application identification is deterministic: it inspects files and dependencies without running application code or asking AI.

## File map

| File | Responsibility |
| --- | --- |
| `ray/src/lib/framework-registry.ts` | Ordered `FRAMEWORKS` definitions: slug, display name, language, suggested port, signatures, and optional start command. |
| `ray/src/lib/framework-detection.ts` | Reads manifests, evaluates registry signatures, and detects TypeScript and workspace indicators. |
| `ray/src/lib/project-detector.ts` | Project/container detection integration, fallback metadata, icons, and badge colors. |
| `ray/src/components/ProjectSetupFields.tsx` | Shared source review and project-name fields for upload setup and existing-project registration. |
| `ray/src/lib/deployment-runtime.ts` | Validates saved environment variables for reuse by deployment paths. |
| `ray/src/lib/project-source.ts` | Resolves application directories and rejects traversal or symlinks outside the selected source tree. |
| `ray/app/api/deploy/analyze/route.ts` | Authenticated source analysis for setup: framework, Dockerfile, port suggestions, and files. |
| `ray/app/api/deploy/upload/route.ts` | Stages uploaded source files. |
| `ray/app/(dashboard)/deployments/new/page.tsx` | Upload, setup, and streamed deployment interface. |
| `ray/app/api/deploy/route.ts` | Creates deployment records and forwards deployment requests to Brain. |
| `ray/src/lib/cicd-runner.ts` | Isolated Git checkout, security audit, deployment dispatch, and pipeline state. |
| `brain/internal/deploy/templates.go` | Dockerfile inspection/generation and production template assumptions. |
| `brain/internal/deploy/docker.go` | Image build, port allocation, container launch, and monitor registration. |
| `brain/internal/deploy/health.go` | Shared configurable HTTP/TCP startup probes. |
| `brain/internal/deploy/routing.go` | Managed HTTPS routes through Caddy. |
| `brain/internal/api/deploy.go` | Internal deployment API and streamed progress events. |
| `ray/src/lib/settings.ts` | Configured deployment-directory lookup. |
| `ray/src/lib/port-manager.ts` | Dashboard port registry and allocation helpers. |
| `ray/src/lib/domains.ts` | Domain helpers; also inspect `ray/app/api/domain-proxy/route.ts` when changing routing. |

## Add a framework signature

Add a definition in `framework-registry.ts`, placing specific frameworks before generic runtime fallbacks:

```ts
{
  slug: "example-framework",
  name: "Example Framework",
  language: "JavaScript",
  port: 3000,
  dependencies: ["example-framework"],
  startCommand: "npm start",
}
```

A signature matches if **any** listed dependency, file, or manifest text pattern matches. Manifest patterns are case-insensitive substring checks, not regular expressions. The first matching definition wins. Use distinctive signatures to avoid misclassifying unrelated applications.

`files` checks paths relative to the selected application directory. `dependencies` reads both dependencies and development dependencies from `package.json`. `manifestPatterns` maps a manifest filename to a text fragment. Manifest reads are limited to regular files up to 1 MiB.

Add icons/colors in `getFrameworkVisuals` in `project-detector.ts` if needed. Suggested start commands are reviewable defaults; detection does not execute them. Monorepo detection identifies workspace indicators. Upload setup and existing-project registration let users select a relative application directory such as `apps/web`, then analyze it before continuing. The selected directory must resolve inside the source root, including after symlink resolution. This selects an application build context; it does not automatically resolve monorepo build dependencies located outside that context.

## Source preparation

Each upload is staged in its own `.upload-<id>` directory under the configured deployments directory. Uploading the same name does not replace or delete the live source directory. Both compressed upload size and declared expanded ZIP size are limited by `MAX_UPLOAD_SIZE_MB`. The drop area automatically distinguishes one folder from one ZIP archive, without a mode switch. Separate file-picker buttons remain available for browsers that require different pickers. Folder uploads preserve relative paths. Staged directories are currently retained; automatic retention and cleanup remain future work.

Existing-project registration first analyzes the server path, then collects the project name, optional URL, and optional start command. Saving a start command does not execute it. The existing-project path is validated as a directory. Git setup is not yet connected to this shared component.

## Detection versus deployment support

The registry includes Next.js, Nuxt, SvelteKit, Vue, React, Express, Fastify, Django, FastAPI, Flask, Laravel, Ruby/Rails, Go, Rust, Java, PHP, Python, Node.js, static HTML, and Docker.

This is a **detection list**, not a guarantee of production deployment support. Docker generation still has its own logic in `DetectAndGenerateDockerfile` in Brain. To support a new stack end to end, review its install/build/start commands, image/runtime, listening interface, internal port, healthcheck, and log sources. A project-supplied Dockerfile is the existing customization path.

Keep host and container ports distinct: the host port is the server-facing binding; the container port is where the application listens inside Docker. A port suggestion alone does not configure the application to listen on that port. Upload setup offers an optional internal-port override; leaving it blank uses Brain’s Dockerfile detection. An override changes the Docker mapping only: the application must already listen on that port. Saved internal ports are reused for redeployment and, for previously deployed containers, CI/CD. Saved environment variables are validated and reused rather than silently discarded when malformed.

See [Security Rules](./security-rules.md) and [Monitoring Rules](./monitoring-rules.md) for the other extension points. The ongoing overhaul and remaining work are tracked in `docs/engineering/workflow-pipeline.md`.

## GitHub source preparation

GitHub repository cards link to the same setup screen used for uploads. Users can also enter a GitHub URL and branch there. Preparation only downloads and analyzes source; users review settings before starting deployment.

| File | Responsibility |
| --- | --- |
| `ray/app/api/deploy/prepare-github/route.ts` | Authenticated, isolated GitHub checkout; branch validation; existing GitHub credentials |
| `ray/src/lib/prepared-source.ts` | One-hour source proof bound to the user, using a key separate from login signing |
| `ray/app/api/deploy/route.ts` | Validates the proof and deploys that checkout without fetching again |
| `ray/src/lib/cicd-sync.ts` | Carries explicit branch and host port into pipeline configuration |

Private repositories use the GitHub connection in Settings. Credentials are not included in browser responses or saved remote URLs. Failed preparations are removed; successful checkouts remain under `.git-setup` in the deployment directory pending a retention policy. If a proof expires, prepare the repository again.

GitHub setup now supports a saved application directory. CI/CD resolves it inside fresh checkouts, and rebuilds reuse the current source snapshot. See [Project Setup](./project-setup.md) for workspace build-context limits and persistence details. HTTPS external Git credentials are covered in [Git Sources](./git-sources.md); submodules and Git LFS downloads remain unsupported. Managed deployment and rebuild paths use the shared [security gate](./security-rules.md).

Production template coverage, explicit entry-point requirements, startup health settings and Caddy configuration are documented in [Templates, Health Checks and HTTPS](./deployment-services.md).

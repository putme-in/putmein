---
id: deployment-services
title: Build Templates, Health Checks and HTTPS
slug: /developer/deployment-services
---

# Build Templates, Health Checks and HTTPS

The shared setup contract now carries production template selection, startup health checks, and an explicit choice between direct-port access and managed HTTPS. Saved configurations without these fields keep direct-port access and gain an HTTP `/` check with a 60-second timeout. Existing Dockerfiles take precedence and are never rewritten by template generation.

## Production templates

Templates live in `brain/internal/deploy/templates.go`; discovery and UI hints live in `ray/src/lib/framework-registry.ts`. Detection identifies a framework, but cannot infer every application entry point or operating-system dependency.

| Framework | Default behavior and requirements |
| --- | --- |
| Next.js | Node 22, package-manager install/build, production Next server on port 3000. No synthetic database URL or ignored build errors. |
| Nuxt | Node build, `.output/server/index.mjs`, port 3000; requires the Node server preset. |
| SvelteKit | Requires configured `@sveltejs/adapter-node`, default `build` output, port 3000. |
| Express, Fastify, Node | Runs the optional build script and production start script; a missing start script requires an explicit command. |
| React, Vue | Builds `dist` (CRA uses `build`), nginx on port 8080 with SPA fallback. Custom output directories require a Dockerfile. |
| Static HTML | nginx on port 8080, normal file serving without SPA fallback. |
| Django | Detects a single one-level `wsgi.py` package and runs Gunicorn on port 8000; include Gunicorn in dependencies. Ambiguous layouts need an explicit command. |
| FastAPI | `uvicorn main:app --host 0.0.0.0 --port $PORT`; include Uvicorn and override a different entry module. |
| Flask | `gunicorn app:app --bind 0.0.0.0:$PORT`; include Gunicorn and override a different entry module. |
| Python | Python 3.12, `requirements.txt` or installable `pyproject.toml`/`setup.py`; explicit production start command. Poetry/Pipenv/uv-only workflows need a custom Dockerfile. |
| Go | Go 1.26 builds the root package into `/out/server`; minimal Debian runtime with CA certificates, port 8080. Build overrides must produce `/out/server`; custom CGO dependencies need a Dockerfile. |
| Rust | `cargo build --release --locked`; explicit release-binary start command; port 8080. |
| Java | Java 21 with Maven/Gradle wrapper; explicit JAR start command; port 8080. Other Java versions or build tooling need a Dockerfile. |
| Ruby/Rails | Ruby 3.3 and `bundle install`; Rails server when `bin/rails` exists, otherwise explicit start command. Native gem libraries may require a Dockerfile. |
| PHP | PHP 8.3 Apache, Composer when present, selected directory as web root, port 80. |
| Laravel | Apache serves `public`, with rewrite and `pdo_mysql`; configure APP_KEY, database and persistent storage yourself. Additional required PHP extensions need a Dockerfile. No migrations run automatically. |

Node uses `npm ci` when a lockfile exists, otherwise `npm install`. pnpm and Yarn require a pinned `packageManager` in `package.json` and their matching lockfiles. Corepack installs the pinned manager during the build. The image keeps build dependencies; image slimming and image/dependency audits remain separate work. Build commands are never retried with permissive fallbacks such as `|| true`.

Generated images generally use a non-root runtime user; PHP uses the official Apache image's startup model. A new `.dockerignore` excludes common secrets and generated/dependency directories; an existing `.dockerignore` is respected. The security gate still runs before template generation. Platform-generated files and downloaded build dependencies are outside that source scan's coverage.

Selected application ports update generated `PORT`/EXPOSE settings and nginx/Apache listeners. Custom Dockerfiles/applications must listen on the configured port themselves. Docker runtime `PORT` must match the application port. A specifically requested host port is never silently replaced with another port; choose automatic allocation when that is desired. Port allocation is not a distributed reservation service. Set Brain’s `RAY_PUBLIC_HOST` to a DNS hostname or IP for direct-port links on a remote server; otherwise links use localhost.

## Health checks

`healthCheck` is persisted with project setup and sent through initial deployment, rebuild, and CI/CD. Docker and host mode use `brain/internal/deploy/health.go`.

- `type`: `http` (default) or `tcp`.
- `path`: local HTTP path such as `/health`; remote URLs are rejected.
- `successStatus`: `0` accepts HTTP 200–399; an explicit value accepts exactly that status (200–499). Redirects are not followed. The previous permissive default accepting 4xx has been removed.
- `timeoutSeconds`: 5–300, default 60.
- `intervalSeconds`: 1–30, default 2.

For managed HTTPS, the HTTP Host header is the configured application domain (useful for Django ALLOWED_HOSTS). Probes connect only to `127.0.0.1` on the selected application host port and do not use ambient HTTP proxies. Cancellation stops waiting. Host checks also verify that the managed process remains alive. TCP verifies that a service listens; it does not prove database or application readiness. Managed HTTPS is for HTTP applications and requires an HTTP check. Ongoing Monitor polling has not been replaced with these startup settings.

A failure prevents a successful deployment result. Existing host rollback still applies; transactional Docker replacement/rollback remains a separate stage.

## Managed HTTPS setup

Managed HTTPS uses a separately installed Caddy instance on the same machine/network namespace as Brain and application host ports. It proxies directly to applications, including WebSockets, rather than through Next.js. This code does not install/restart Caddy, change DNS, open firewall ports, or obtain a certificate during development.

1. Install Caddy using its official distribution and reserve public ports 80 and 443. Point each application's A/AAAA DNS records at this server. Remove incorrect AAAA records. A concrete sslip.io hostname can be used where its DNS points at the server; wildcard certificate provisioning is not included.
2. Bootstrap the dedicated managed server using `docs/examples/caddy-managed.json`. Validate it with `caddy validate --config docs/examples/caddy-managed.json`, then configure your Caddy service to run that configuration. Do not replace an unrelated production Caddy configuration with this example. If integrating with an existing instance, reserve the `ray-managed-server` block for Ray and resolve listener conflicts yourself.
3. Set `RAY_CADDY_ADMIN_URL=http://127.0.0.1:2019` in Brain's environment. The admin endpoint must remain private. Brain accepts only loopback HTTP endpoints and does not follow redirects. Host-mode applications run as Brain's account and are trusted code; this is not an isolation boundary against them.
4. Preserve Caddy's certificate/config storage and use its documented `--resume` behavior after restarts. Preserve Brain's route registry at `~/.ray/routing/routes.json`, or `RAY_ROUTING_DIR`. A missing or mismatched registry blocks updates when Caddy has active routes and must be restored/reconciled before making changes; do not treat it as disposable if routes are active.
5. In project setup choose **Domain with managed HTTPS**, enter `https://app.example.com`, and deploy. Domain URLs must contain no credentials, custom port, path, query, or fragment. Changing desired settings applies on the next deployment.

Brain checks Caddy availability and domain ownership before build, then activates the route after local health passes. It updates only the dedicated `ray-managed-server` configuration block. Unknown hosts receive 404. Docker publishes managed HTTPS upstream ports on loopback; host-mode applications must honor their own bind settings and server firewall policy. Caddy obtains/renews certificates and handles HTTP-to-HTTPS redirects.

A successful route update means configuration was accepted, **not** that public DNS or certificate issuance has completed. Certificate validation can remain pending or fail: inspect Caddy logs and verify DNS, ports 80/443, outbound ACME access, and CA rate limits. No DNS-provider credentials or wildcard ACME integration are implemented here. No external end-to-end certificate check is performed by startup health probes.

Deployment, project deletion, and linked Monitor/container stop controls remove managed domain routes before destructive cleanup; failures are reported instead of silently deleting deployment records. Stopping/removing managed runtimes removes their domain routes; host restart reattaches after health succeeds. Stopped routes can be restored by redeployment. A Caddy failure can prevent a stop action from completing: restore Caddy and retry, rather than leaving a stale route pointing at a potentially reused port. Routes are owner/project scoped and conflicts are checked across users. One Brain process must be the only writer to the reserved Caddy block and route registry. Distributed locking and crash-atomic coordination between Caddy and the registry are not implemented. Back up both stores and reconcile them after a crash during updates.

Existing global routing/provider preferences no longer cause deployment to invent an unconfigured URL. Explicit per-project setup controls managed HTTPS. Direct-port mode may retain a saved reference URL for existing externally managed routing; that reference does not provision DNS/TLS. The old Ray HTTP proxy remains a compatibility path, with owner-linked healthy deployment resolution and no forwarded internal authentication header; use Caddy for full WebSocket/HTTPS support.

## File map and review

| File | Role |
| --- | --- |
| `brain/internal/deploy/templates.go` | Template generation and custom Dockerfile preservation |
| `brain/internal/deploy/health.go` | Validated local HTTP/TCP probes |
| `brain/internal/deploy/routing.go` | Caddy requests, domain ownership, and durable route registry |
| `ray/src/lib/project-setup.ts` | Shared validated fields and backward-compatible defaults |
| `ray/src/lib/project-setup-store.ts` | Saved settings and Brain payload |
| `ray/src/components/DeploymentServiceFields.tsx` | Shared access and health fields |
| `docs/examples/caddy-managed.json` | Operator bootstrap configuration |

Before publishing, review representative real builds, a slow-start service, expected-status failure, TCP service, a custom internal port, a WebSocket app behind Caddy, certificate issuance, a domain conflict, stop/redeploy route cleanup, and server restart persistence. Compilation and isolated checks cannot substitute for these live checks.

References: [Caddy configuration API](https://caddyserver.com/docs/api), [automatic HTTPS requirements](https://caddyserver.com/docs/automatic-https), [Node release support](https://nodejs.org/en/about/previous-releases), and [SvelteKit adapter-node](https://svelte.dev/docs/kit/adapter-node).

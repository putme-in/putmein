# Workflow pipeline implementation notes

Target: Git / upload / existing path → shared setup → deployment → project → security → monitoring.

## Implemented in this pass

- Deterministic framework registry in `ray/src/lib/framework-registry.ts` with 20 signatures. Setup analysis and project detection consume it. Detection exposes production command suggestions and a monorepo indicator; it never executes code. Upload and existing-path setup now include an application-directory selector.
- CI/CD clones into a separate release directory before scanning, then deploys that exact directory without another Git fetch. The previous source directory is not reset or cleaned. GitHub credentials are passed through process environment configuration, rather than saved in remotes or embedded in command arguments. Pipeline and run lookup are scoped together to the owner.
- Docker deployments explicitly register `docker:<container>` log sources, retaining discovered file logs. Log polling uses timestamp cursors and suppresses unchanged command snapshots. Framework-specific process listings are no longer presented as application logs.
- Deterministic alert rules in `brain/internal/monitor/log_rules.go` recognize common runtime failures independently of AI, with a five-minute cooldown per rule/project.
- Deployment stream parsing retains incomplete lines across network chunks. Both the server and upload UI require a completion event; arbitrary successful steps or words in logs cannot mark a deployment complete.
- A timed-out HTTP healthcheck now fails deployment, and HTTP 5xx does not count as healthy. This remains an HTTP-only check; non-HTTP services need configurable checks.
- Authenticated monitor registration and deployment-directory settings lookup carry the Brain secret.
- Removed secondary Jersey headings and the unconditional claim that a security audit passed from the upload flow.

## Developer Guide and shared setup pass

- Published contributor file maps and extension instructions under Developer Guide: Application Detection and Deployment, Security Rules and Scanning, and Monitoring Rules. These pages describe current coverage and limitations, rather than treating detection as deployment support.
- Added `ProjectSetupFields` shared by upload setup and existing-project registration. Existing paths now have a source-analysis step before setup. Both flows support selecting and re-analyzing a relative application directory with real-path containment checks.
- Existing-project setup saves an optional start command without executing it. Server-side path, name and URL validation rejects invalid registration requests.
- Uploads stage into unique directories instead of deleting or overwriting a directory with the same project name. Folder uploads preserve browser-relative filenames; expanded ZIP size is bounded. Staging directories are retained pending a cleanup policy.
- Upload host ports are validated before dispatch and reserved ports produce a clear validation response.
- Restored the internal authentication header on security checklist retrieval.
- Documentation production build and Ray TypeScript check passed. No tests, browser interactions, schema changes, service restarts or deployments were performed.

## Remaining requested work

1. Extend the shared upload/existing-path setup to GitHub and external Git; framework override; project name, environment, start/build commands, container/internal port, public port, domain and Docker choice.
2. External Git credential storage/settings, private repository authentication and source browsing. CI/CD runner currently accepts HTTPS repository URLs; there is no new external-Git UI or credential model in this pass.
3. Persist the complete setup configuration and apply it consistently across deploy, redeploy, project editing and chat.
4. Managed non-Docker deployments into the configured directory, with process lifecycle and durable stdout/stderr capture.
5. Framework-specific deployment generation aligned with the registry. Detection support does not imply every framework already has a production Docker template.
6. Domain routing and configurable healthcheck behavior; container replacement/rollback and concurrent deployment locking.
7. Extensible multi-language code security scanning, incremental changed-file scans, and a default-on gate for every update path. Existing CI/CD security scans still inspect the full checkout. Post-deployment scan failures need visible durable status and alerts.
8. Custom per-project log matchers and logger configuration; dashboard-first incident presentation; bounded release retention/cleanup. Isolated release directories are currently retained for inspection.
9. Enforced interactive chat setup using the same validated deployment contract, with sensitive credential input outside normal chat history.

## Verification

TypeScript type checking and Go compilation were run. Automated tests, browser interaction and application deployments were intentionally not run at the user's request.

Suggested user checks: split an SSE completion event across chunks; close a deployment stream early; produce HTTP 500 or a healthcheck timeout; reject a CI/CD security scan and confirm the live directory is untouched; emit a Python traceback or Node unhandled rejection from a deployed container and confirm an alert appears without an AI provider; confirm repeated polling does not re-read the same Docker log window.

## Upload error investigation

- Shared upload-size configuration now aligns Next.js proxy buffering with `MAX_UPLOAD_SIZE_MB`, including multipart overhead. Proxy timeout and upload route duration are five minutes. This fixes a limit mismatch, but does not explain an immediate failure on a few-KB ZIP by itself.
- Confirmed a 179-byte diagnostic ZIP uploads through the browser file picker and reaches Static HTML setup. No application was deployed.
- A retained browser/server log shows an immediate failure through the folder-drop handler. Directory drops previously submitted directory placeholders as files. The UI now walks directory entries, captures real files and relative paths, rejects directories in ZIP mode, and reports unreadable ZIPs before submitting.
- Relative folder paths are sent explicitly because multipart parsers may strip path components from filenames.
- The original ZIP-specific failure has not been reproduced; ask for the browser Network failure reason if selecting the original ZIP again still fails. Folder drag-and-drop changes have been type-checked, not exercised end to end.

## Automatic source selection and runtime settings pass

- Removed the ZIP/folder mode switch. One drop area detects a folder versus a ZIP; native picker actions remain for accessibility and browser compatibility.
- Added optional internal/container port override, separately from the host port. Blank means Dockerfile detection. This only maps the port; it does not rewrite the app's listening configuration.
- New deployments store selected ports using existing schema fields. Brain accepts and reports the internal port; redeployments and CI/CD carry saved runtime settings forward. CI/CD now also passes stored environment variables, with malformed configurations rejected instead of silently discarded.
- Redeployment SSE parsing now buffers split lines and requires a completion event, matching the initial deployment behavior.
- TypeScript checking and Go compilation passed. No schema migration, live deployment, or automated test suite was run. Broader Git setup, Docker-off support, domain routing and security work remain pending as listed above.

## GitHub shared setup: first milestone

- GitHub repository cards now open deployment setup with the repository and its default branch prefilled. Deployment setup also accepts a GitHub URL directly.
- `POST /api/deploy/prepare-github` authenticates the user and creates an isolated checkout under `.github-setup`. Public repositories work without a GitHub connection; private repositories use the existing integration. Branch names are validated and no application build/start command runs during preparation. Submodules are not fetched and Git LFS files are not downloaded.
- Preparation returns a one-hour, user-bound source proof using a separate signing key derived from the authentication secret. Deployment verifies it, derives source metadata on the server and sends the inspected local checkout to Brain without another fetch. Credentials are passed through the Git process environment, never returned to the client or saved in the remote URL.
- Setup reuses the existing name, framework review, host/internal port and environment controls. GitHub currently builds from the repository root; subfolder selection is disabled until CI/CD and redeploy can persist it consistently. Existing upload and path-based selection remain available.
- Pipeline synchronization now applies an explicitly supplied branch and host port to an existing pipeline. Source preparation does not create a deployment or pipeline.
- Dockerfile preview skips symlinks and files larger than 1 MiB.
- TypeScript checking passed. No live clone, deployment, automated test suite, schema migration or service restart was performed for this milestone.

Next: persist application directory and the complete setup contract across initial deployment, CI/CD, redeploy and project editing; then external Git credentials and settings. The broader security gate, Docker-off lifecycle, domain routing, rollback, monitoring controls and guided chat setup remain pending. Legacy direct deployment/redeploy paths still need the security and credential handling overhaul. Successful/abandoned prepared checkouts need the planned retention policy.

## Setup completion stage (ready for review)

- Added a versioned setup contract and shared fields for framework override, build/start commands, application directory, ports, application URL and runtime environment variables across upload, GitHub and existing-path setup.
- Added owner-scoped setup editing on the project page. Settings are persisted atomically outside source checkouts in `~/.ray/project-setups` (or `RAY_SETUP_DIR`), with restricted permissions. No database migration is required. This directory contains runtime secrets and must be included in restricted backups/persistent volumes.
- Initial deployment, both rebuild endpoints and the CI/CD runner consume saved settings. Rebuilds reuse the current snapshot. CI/CD selects the application directory inside a new checkout and advances the saved root after success. Existing-path registration rebases Git subdirectories to their actual repository root.
- Pipelines now prefer stable project identity so multiple apps can share a repository. Deployment callbacks preserve existing project links. Configured GitHub webhook deployments use the setup-aware runner and match the repository/branch rather than repository-name substrings.
- Brain applies supported framework overrides and build-command overrides to generated Dockerfiles. Start-command overrides execute inside the container using `/bin/sh -c`. Custom Dockerfiles retain their own build commands; generated files are marked for later regeneration.
- Existing URL and pipeline port editors synchronize their corresponding saved fields. Source `.env` files remain distinct from runtime environment variables, as explained in the UI.
- GitHub nested application selection is enabled. The selected directory is the build context; workspaces that require sibling packages still need a repository-root Dockerfile.
- Docker remains required for managed execution, and application URLs do not configure DNS/TLS/routing. Those implementations remain separate stages, alongside broader templates, security gates, incident controls and chat.
- Added Developer Guide → Project Setup with file map, storage/backup instructions, behavior and manual-review checklist. TypeScript and Go compilation passed. No test suite, live deployment, database migration, service restart, commit or push was performed.

This stage supersedes the earlier root-only GitHub limitation and the pending setup-persistence items above. Concurrent deployment locking and distributed setup-write coordination are not part of this stage.


## Docker-off stage (ready for review)

- Docker remains default/recommended; shared setup now permits host execution with an explicit foreground start command. Host mode uses installed runtimes on Linux/macOS and passes selected `PORT` and application environment settings.
- Brain stages independent releases in the configured deployments directory. Builds precede replacement; startup uses HTTP health checks. Stop/restart/delete/cancel and Monitor controls use verified process groups, with restart recovery and durable stdout/stderr logs outside source. No database migration.
- Host build environments exclude inherited platform secrets. This is not OS isolation: application commands run as Brain's account. Only trusted code belongs in host mode.
- Initial deploy, both rebuild paths and configured CI/CD propagate runtime choice. Runtime switches require stopping the current deployment. Host UI avoids Docker container actions and misleading Docker status/terminal targets.
- Project deletion stops host processes before deleting records and does not perform broad Docker-name cleanup for host projects. Isolated host builds have a ten-minute deadline and longer request/stale-build allowances.
- Developer Guide → Project Setup documents files, storage, constraints and manual checks. Focused tests cover environment filtering, verified group stop, independent source staging and manifest permissions. No live application deployment, schema migration, service restart, commit or push was performed.

This supersedes the earlier Docker-required/pending Docker-off entries. Remaining priorities are external Git settings/credentials, universal and incremental security gates, framework templates, domain routing/configurable health checks, log/release retention and richer incident controls, and guided chat setup. Host locking is local to one Brain process; broad distributed locking and transactional rollback remain pending.


## HTTPS Git / private sources stage (ready for review)

- Added Settings → Git sources and a saved-source list beside the existing GitHub browser. Supports public or private HTTPS repositories with repository-scoped username/token credentials, edit/rotation/removal and direct links into shared deployment setup.
- Tokens are encrypted in owner-scoped files outside repositories, never returned to the browser. Default storage is `~/.ray/git-connections`; `RAY_GIT_CONNECTIONS_DIR` overrides it. Preserve the server authentication key and encrypted files in backups. No schema migration.
- Preparation and CI/CD share isolated checkout with clean Git configuration/environment, credentials passed through scoped environment headers, disabled redirects/hooks, TLS validation and validated/pinned destination addresses. Internal Git hosts require an explicit operator allowlist.
- CI/CD validates generic HTTPS Git URLs. GitHub private access still uses the existing integration unless a saved source overrides it. External source pipelines default to manual runs and cannot enable unsupported GitHub-only push automation.
- GitHub webhook matching now scopes per-integration authorization to the owner and verifies clone URL identity. Legacy standalone webhook checkouts use fresh directories and safe credential handling, and Git failures stop dispatch.
- Added Developer Guide → Git Sources & Private Repositories with the contributor file map, operational details, limits and manual review steps. Verification uses TypeScript checking, focused isolated credential/network regression checks and docs build; no live private clone/deployment, service restart, commit or push.

### Remaining overhaul work, in suggested order

1. Universal default-on security gate across every entry/update path, configurable opt-out, changed-file scans for updates and extensible framework/language rules. Visible durable scan outcomes.
2. Complete framework build templates, configurable health checks (including non-HTTP services), domain/HTTPS routing and port consistency.
3. Deployment concurrency/rollback beyond current local host locking; safe retention/pruning of checkouts, releases and logs.
4. Monitoring custom log patterns and logger settings, richer dashboard-first incidents and later notification delivery.
5. Guided chat setup using the same contract, with interactive required fields and secret input outside chat history.
6. Git extensions: SSH keys, submodules/LFS, external-provider account browsing, provider-specific webhooks or polling, and optional corporate proxy/CA support.

This stage supersedes the pending HTTPS external-Git credentials/settings work above. It does not claim provider-wide Git feature coverage or a completed security overhaul.


## Shared security gate stage (ready for review)

This supersedes the pending shared/incremental security gate entries above.

- Managed Git, upload, local-source, rebuild, CI/CD, and legacy webhook dispatches now stage source and enter one Brain gate before build/live replacement. Host restarts also scan before stopping the existing process. Standalone registration does not gate an already-running app.
- Deterministic multi-language source-rule registry, secret signatures, scoped dependency checks, explicit coverage, and full/incremental reports replace the old AI-assisted scanner. Unchanged findings survive; deleted files are removed; changed rules force a full scan. Baselines advance only after successful releases.
- Danger findings and incomplete/persistence-failed scans block. Administrator policy defaults on; disabled operations are recorded as skipped. Ray persists reports and creates linked-project alerts.
- CI/CD risk approval is bound to the exact run's report, owner/project, complete source snapshot, runtime settings, and rule version, with a ten-minute expiry. Scan errors cannot be overridden.
- Developer Guide → Security Rules and Scanning contains extension instructions, storage/settings, limits, and coverage caveats. No database migration, live application deployment, service restart, commit, or push.
- Focused isolated checks cover incremental retention/deletion, credential redaction, escaping symlinks, scan limits/cancellation, advisory version boundaries, excluded-file fingerprints, approval binding, and persistence failure. Go build, Ray typecheck, and documentation build are the compilation checks for this stage.

### Remaining priorities

1. Framework production build templates, configurable/non-HTTP health checks, and domain/HTTPS routing.
2. Transactional replacement/rollback, distributed operation locking, and source/log/report retention.
3. Custom project log rules/logger settings and richer dashboard incidents; delivery integrations later.
4. Guided chat setup and dedicated secret inputs using the shared contract.
5. External-provider webhooks/polling, SSH keys, submodules/LFS, and broader provider browsing.
6. Deeper security integrations: ecosystem dependency audits, container scanning, whole-program analysis, scheduled rescans, and post-build/runtime verification. The implemented bounded source checks do not claim that coverage.


## Production templates, startup health checks and managed HTTPS

- Replaced permissive generation with production-oriented templates for the registry's framework families. Custom Dockerfiles are preserved, dependency/build failures are no longer suppressed, and ambiguous binary/JAR/Python entry points require explicit commands. Package-manager locks, static SPA serving and generated listener overrides are handled. Template assumptions are visible in setup.
- Shared saved setup now carries HTTP/TCP startup checks, local path, expected status, timeout and interval. Docker and host execution use the same probes. Existing setups default to direct access and HTTP 200–399 on `/`; this tightens the former acceptance of 4xx.
- Explicit per-project managed HTTPS configures a reserved Caddy server after application health succeeds. Owner-scoped domain routes are persisted and checked against Caddy before updates; mismatched/lost state blocks overwriting. Docker upstreams bind loopback. Stop/removal clears routes; host restart reattaches after health. Global legacy naming settings no longer invent unconfigured deployment URLs.
- The old Next proxy no longer forwards platform authentication headers, resolves only owner-linked healthy deployments, and routes application asset paths correctly. Managed Caddy routing supports direct application WebSockets.
- Developer Guide → Templates, Health Checks and HTTPS includes operator bootstrap, framework requirements, storage/restore details and manual review checks. Caddy is not installed in this development environment; real image builds, public DNS, certificate issuance, WebSocket traffic and lifecycle behavior require live review. No services were restarted or applications deployed.
- Compilation checks and isolated tests cover template output/preservation, port overrides, setup migration/validation, health validation/cancellation, domain validation and lost/mismatched route registry protection. These do not claim successful image builds or live Caddy integration.

Remaining: full transactional replacement/rollback and distributed locking, release/log/report retention, richer custom monitoring rules/incidents, guided chat setup, deeper security integrations and external Git provider extensions. Framework-specific OS libraries, persistent application volumes and build-secret integration may require a custom Dockerfile.


## Deployment lifecycle: concurrency, rollback and retention

Managed lifecycle operations now share a cross-process server lock. Project deletion uses a durable reservation across Ray/Brain steps. Docker replacements retain the previous container and unique image; host replacements retain the prior build and both runtimes have recovery journals. Project settings expose rollback, interrupted-deployment recovery and cleanup preview/apply.

Cleanup is deliberately limited to tracked snapshots and ownership-labelled retired Docker artifacts, preserving active/previous/journal sources and the newest three records plus seven days. New Docker containers rotate logs; hourly host maintenance deletes only expired, unprotected retired logs.

See [Developer Guide: deployment lifecycle](../docs/developer/deployment-lifecycle.md). Remaining retention work: continuous active-host log rotation, database build-log/history retention, and explicit migration/adoption of legacy untracked artifacts. Deployment queueing and distributed concurrency are not implemented.


### Database log history retention

Project settings now support previewing and explicitly clearing old deployment/CI log text. Thirty-day age limits and the newest ten records of each kind are preserved; healthy deployments and active runs are excluded. Cleanup retains records and stage metadata, uses owner-scoped queries and content fingerprints, and rechecks eligibility in a serializable transaction. There is no automatic database sweep or schema migration. Remaining retention work is continuous active-host log rotation and review/adoption of legacy artifacts.


### Active host log rotation

New host starts now launch an independent collector alongside the foreground application in the same verified process group. It retains three 10 MiB segments, continues through Brain restarts, and stops the application if log writing/rotation fails. Monitor preserves absolute byte cursors across rotations and reports skipped bytes when retention overtakes a reader. The dashboard's offline tail reader supports segmented logs, and expired retired directories use the same seven-day protection policy as older log files. Existing processes adopt rotation only at their next restart/deployment.

Remaining retention work: conservative review/adoption of legacy artifacts. Database cleanup and active-host rotation are now implemented; multi-server deployment coordination and queueing remain separate features.


## Current status after monitoring and incident work

This section supersedes earlier remaining-work lists above. Legacy artifact review/quarantine/restore, custom project monitoring rules and JSON loggers, a dashboard incident panel, browser-independent alert persistence, and a durable disk-backed alert delivery queue are implemented. Production UI/deployment validation remains the operator's review step.

Remaining core overhaul work:

1. Guided chat setup with required shared setup fields, explicit review before deployment, and dedicated secret inputs instead of credentials in chat text.
2. Consolidated incident handling across runtime alerts, deployment failures and security findings; acknowledgement/reopen history and an outbox administration view. Current dismissal is not a full incident lifecycle.
3. Security expansion: dependency ecosystem tools, image scanning, deeper code analysis, scheduled rescans and post-deployment verification. Existing source gates do not supply this broader coverage.
4. Additional Git support: SSH credentials, non-GitHub webhook/polling automation, provider browsing, submodules and LFS.
5. Deployment scheduling/queueing and multi-server coordination. Existing lifecycle serialization and rollback serve the current single-server model.
6. Email/browser notification delivery, intentionally deferred by the original request.

Final release review should cover real Docker/host deployments, private Git, rollback, Caddy/DNS/HTTPS, permission isolation and outage recovery. Automated checks performed so far do not replace that live review.

Recommended next implementation: guided chat setup, connecting the existing shared setup contract to a deterministic conversation flow.


### Chat deployment setup integration

The former direct chat deployment action now requests an inline shared setup card and ends the agent turn. The user prepares the source, edits settings and explicitly reviews before submitting to the normal deployment API. Private Git connection editing is available inside the card, shell token injection is removed, and form values stay outside the model conversation. The standalone deployment page uses the same extracted component.

This implements the initial guided chat setup priority. Remaining chat refinements are durable saved drafts/completion state, automatic sanitized pipeline-result feedback to the model, and broader tool-level policy enforcement for general shell administration. See [Chat Deployment Setup](../docs/developer/chat-deployment.md) for limitations and live review steps. The next broader overhaul priority is unified incident handling across runtime, deployment and security records.


### Chat continuity follow-up

Non-secret browser-local setup drafts and deployment-ID recovery are implemented. Reopening a linked card shows its existing deployment. A session/deployment ownership-checked endpoint updates one sanitized conversation message from database status, and that message is available to the next model turn. It does not autonomously invoke the model. Commands, credentials, environment values, health settings and source proofs are excluded from drafts.

Remaining chat refinements are cross-device draft recovery, background status synchronization while chats are closed, and broader general-shell tool policy enforcement. The existing deployment pipeline and explicit review remain authoritative. See Chat Deployment Setup for recovery limits.


### Unified incident handling

The dashboard and dedicated Incidents page now combine runtime alerts, failed deployment attempts and adverse security scans. Owner-scoped acknowledge/dismiss/reopen state, revision/fingerprint checks, latest-20 history, source filters, pagination and exact-scan links are implemented without changing source health or risk approvals. Matching synthetic security alerts are deduplicated. Inventory is bounded to 300 records per source and explicitly reports truncation.

Remaining incident work includes shared assignments, expanded historical search, durable full audit history, and source-screen badge/state convergence. See [Unified Incidents](../docs/developer/incidents.md). The next substantial pipeline priority is deeper dependency/container security analysis and scheduled rescans; provider expansion and external notification delivery remain separate tracks.


### Dependency/image gates and scheduled rescans

Opt-in administrator policy now enables Trivy dependency scans, local immutable-image gates (including rollback), and scheduled source/vulnerability rescans. Missing/stale tools/data, scan errors and high/critical findings block enabled deployment checks. Settings default off; no tools or advisory databases are installed automatically. Schedules retain pending reports for retry and serialize against managed lifecycle operations. See [Advanced Security Scanning](../docs/developer/advanced-security.md).

Remaining security work includes whole-program analysis, runtime exploit verification, broader dependency formats, report retention, and live scanner/Docker validation. Remaining broader tracks: non-GitHub automation/SSH/LFS/submodules, deployment queues/multi-server coordination, incident history/assignment refinements, and optional external notifications.


### Deployment review feedback (2026-10-06)

- Fixed automatic Git polling comparing abbreviated remote IDs with full runner IDs. Failed attempts count as attempted commits; manual retry remains available. Active attempts are not considered stale after 90 seconds. A serializable recheck prevents concurrent poll requests creating duplicate runs. Polling now uses the existing isolated, credential-scoped Git transport.
- Simplified the setup header and replaced duplicate progress meters with a single stage list including Security. Generic failure events preserve the actual failed stage. Floating deployment headings show the project name only.
- Security-blocked diagnosis reads the owner-scoped scan and lists file locations without an AI guess. Direct report links replace misleading AI-remediation actions; ordinary retries are labelled as retries and require a deployment ID.
- Secret scanning ignores only complete all-x API-key placeholders, continues looking for subsequent credentials in the same file, and avoids labelling valid Anthropic-pattern matches as OpenAI too. Documentation and example files remain scanned. Existing saved reports remain unchanged until a new scan.
- Focused fixture checks and type checking cover these fixes. Live deployment, browser layout review, and report-specific risk decisions remain operator review steps.

### Chat plan and setup feedback (2026-10-06)

Plan cards now extract only Markdown task-list entries; headings and explanatory prose remain formatted details. The plan panel renders Markdown and reads checked task state from updated plan content, including a completed status when every task is checked. Action-mode instructions request evidence-based checklist updates without treating setup as deployment completion. Model compliance still requires live review.

Completed deployment tools render setup feedback even for legacy tool names. Missing or malformed setup payloads offer an explicit New deployment link instead of silently disappearing. Responses that mention a setup card without a tool request show a recovery notice; this does not invent a tool result or start deployment. Checklist parsing, draft safety, API tests and type checks cover the change; live chat/UI review remains pending.


### Compact chat deployment and framework handoff

The full embedded wizard was replaced with a compact name/source/address confirmation, automatic source inspection, shared-settings propagation and a chat-oriented progress display. Failed records schedule one diagnostic follow-up in the open idle chat; the assistant can investigate scoped corrections and request specific attention. Corrected retries still use the managed pipeline. Internal setup events no longer activate or populate the terminal. Automatic framework choices now resolve through Ray's registry at the deployment boundary, including rebuild payloads, instead of independently switching frameworks in Brain.

Focused checks cover mixed Python/frontend framework handoff, non-secret chat settings and existing pipeline/draft behavior. Real SearXNG deployment and browser presentation still require live review. This does not claim universal automatic repair or support for every repository layout.

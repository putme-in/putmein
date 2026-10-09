---
id: security-rules
title: Security Rules and Scanning
slug: /developer/security-rules
---

# Security Rules and Scanning

Brain checks staged source before managed builds and deployment. Ray stores reports and displays findings. Checks are deterministic: this pipeline does not send source code to an AI provider. Paths below are relative to the repository root.

## Release workflow

1. Git, ZIP/folder uploads, and local-source deployments enter `deploy.ExecuteDeployment` with prepared local source.
2. Brain copies that source into an isolated `.security-releases` directory inside the configured deployments directory. It does not pull or reset the running application's checkout.
3. The security gate checks source before running build commands or replacing the live runtime. `danger` findings block; `warning` and `info` findings allow deployment. Incomplete scans and report persistence failures also block.
4. Successful builds proceed through the existing runtime and health-check flow. Only a successful deployment commits its next incremental scan baseline.
5. Reports remain available in Security. Findings for linked projects also create dashboard monitoring alerts. Docker-off restarts recheck source before stopping the current process; Docker restarts reuse the existing image.

A security block leaves the previous runtime running. This is not a promise of zero-downtime replacement or Docker rollback after a later build/start/health failure. Registering an already-running project does not retroactively gate its running process; use a manual scan and the managed deployment flow for subsequent releases.

The server-wide **Security checks** setting defaults to enabled. An administrator can disable it; affected operations record `skipped`, not `passed`. Request fields cannot turn the gate off. Ray and Brain must share `BRAIN_INTERNAL_SECRET`, and Brain's `RAY_URL` must reach Ray so reports can be saved before deployment proceeds.

## File map

| File | Responsibility |
| --- | --- |
| `brain/internal/security/source-rules.json` | Editable source-pattern rules for Python/Django/Flask, JavaScript, PHP/Laravel, Go, Ruby, Java, .NET, Rust, and shell files. |
| `brain/internal/security/rules.go` | Checklist metadata, severities, and secret signatures. Metadata alone does not implement a check. |
| `brain/internal/security/engine.go` | File discovery, deterministic rules, dependency version checks, fingerprints, incremental reuse, and coverage reporting. |
| `brain/internal/security/scanner.go` | Request, finding, checklist, and report types. |
| `brain/internal/security/service.go` | Manual scan coordination and a small in-memory recent-report cache. Ray remains the dashboard report store. |
| `brain/internal/security/prompts.go` | Legacy AI prompt helper, unused by the deterministic scanner. |
| `brain/internal/deploy/security_gate.go` | Shared gate, report persistence, approval validation, deployment cancellation, and successful-release baselines. |
| `brain/internal/deploy/host_source.go` | Isolated source copying and path/file limits. |
| `brain/internal/deploy/host.go` | Docker-off lifecycle, including checks before restarting source. |
| `brain/internal/api/security.go` | Brain scan and rule endpoints. |
| `ray/app/api/security/internal/report/route.ts` | Authenticated Brain report persistence and linked-project alerts. |
| `ray/app/api/security/scan/route.ts` | Owner-authorized manual scans. |
| `ray/app/api/security/scans/route.ts` | Owner-scoped scan history and statistics. |
| `ray/app/api/security/override/route.ts` | Explicit approval for the scan attached to a blocked CI/CD run. |
| `ray/src/lib/cicd-runner.ts` | CI/CD stage display and blocked-run handling using the shared Brain gate. |
| `ray/app/(dashboard)/security/page.tsx` | Findings, reports, and risk approval UI. |
| `ray/prisma/schema.prisma` | Existing `RaySecurityScan` and monitoring alert models; no migration required. |

Brain exposes `POST /v1/security/scan`, `GET /v1/security/rules`, and `GET /v1/security/scans`. Browsers use authenticated Ray APIs, not Brain directly.

## Incremental scans and storage

The first managed release gets a full scoped scan. Later releases hash files and reevaluate changed or added files; unchanged findings are retained, and findings for deleted files disappear. A change to the embedded engine, source rules, or secret signatures invalidates the baseline and forces a full scan. Failed deployments never replace the successful baseline. Manual scans are full scans.

Brain saves owner/project-scoped baselines and diagnostic reports under `~/.ray/security`, configurable with `RAY_SECURITY_DIR`. Directories use owner-only permissions; reports and baselines use private files. Persist this directory across Brain upgrades to retain incremental baselines. Losing a baseline causes a full rescan, not a bypass. Reports and staged releases currently require operator retention management.

CI/CD risk approval requires both acknowledgement and deployment consent. It is tied to the blocking run, owner, project, complete snapshot fingerprint, runtime settings, and rule fingerprint, and expires after ten minutes. The pipeline scans again: changed source or settings cannot reuse the approval. A scan error cannot be overridden. The signed approval stays server-side. Direct deployment blocks can be fixed and retried; this approval UI currently applies to CI/CD runs.

## Add a source check

1. Add an entry to `source-rules.json` with a unique `id`, `title`, `extensions`, optional `basename`, Go-compatible regular-expression `pattern`, `severity`, `category`, `description`, and `recommendation`.
2. Choose `danger` only when the match should block deployment. Existing general language patterns are warnings because a regex cannot determine exploitability.
3. Add clean and failing fixtures to `engine_test.go`. Include unchanged-file reuse and deletion when introducing stateful analysis.
4. For checks requiring parsing, implement them in `engine.go` and mark their checklist evaluation. Secret signatures belong in `SecretPatterns` in `rules.go`.
5. Rebuild Brain. The registry is embedded at build time; changes are not hot-loaded.

Never include matched credentials or source snippets in findings or logs. Reports contain rule IDs, locations, and remediation. Rotate any actual credential discovered in source.

## Coverage and limits

This is a bounded pattern scanner, not CodeQL, a dependency audit service, a sandbox, or proof that an application is safe. Build scripts still execute project code. Arbitrary shell access outside managed deployment remains outside this gate. Framework detection does not automatically provide comprehensive security coverage.

Scans skip `.git`, `node_modules`, `.next`, `dist`, `build`, `vendor`, `.venv`, `venv`, `__pycache__`, `target`, `bin`, `obj`, and managed release directories. Binary/non-UTF-8 files are not analyzed. The scoped scanner allows 100,000 entries, 8 MiB per file, 128 MiB of included file content, and 10,000 findings. It has a 60-second deadline. Exceeding a limit, unreadable source, special files, or escaping/broken source symlinks fails the scan. Binary assets are recognized by content before applying text-file and text-budget limits, so a large WAV/image does not fail source scanning merely because of its size. Renaming source code to a media extension does not exempt it. Excluded assets remain outside source-rule coverage and still participate in snapshot fingerprinting. Snapshot copying/fingerprinting has its own 100,000-entry and 2 GiB limits. Dependency/generated content participates in approval fingerprints even though content rules do not scan it.

Reports show full/incremental mode, evaluated/reused file counts, and excluded entries (a skipped directory counts as one entry). Unimplemented or inapplicable checklist entries are `not_evaluated`, never automatically passed. A `passed` report means the implemented checks found no issues in scope. Dependencies fetched during a subsequent build, generated platform Dockerfiles, and container images are not audited by this source scan.

The implemented Next.js dependency checks cover two manually maintained advisories, using exact versions from `package.json` and npm `package-lock.json`. Unsupported version expressions and malformed manifests produce warnings. Other ecosystems and lockfile formats still need dependency-audit integrations. Advisory references:

- [Next.js middleware authorization bypass, CVE-2025-29927](https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw)
- [Next.js Server Actions SSRF, CVE-2024-34351](https://github.com/vercel/next.js/security/advisories/GHSA-fr5h-rqp8-mj6g)

See [Application Detection and Deployment](./application-frameworks.md), [Project Setup](./project-setup.md), and [Monitoring Rules](./monitoring-rules.md) for the adjacent extension points.

## Review before publishing

Use a disposable project to verify a clean deployment, a blocked credential fixture with the previous app still running, an unchanged finding on a second scan, and removal of that finding after fixing the file. Confirm a failed scan is shown as incomplete, disabled policy is shown as skipped, and an approval cannot be reused after a new commit. Check both Docker and host mode; source fixtures should use synthetic credentials only. Live deployment/browser validation remains part of the application owner's review.


## Optional deeper checks

See [Advanced Security Scanning](./advanced-security.md) for administrator-enabled dependency/image vulnerability scanning and scheduled rescans. These supplement the source registry; they require a separately installed scanner and maintained advisory cache, and default off.

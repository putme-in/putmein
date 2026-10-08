---
id: advanced-security
title: Advanced Security Scanning
slug: /developer/advanced-security
---

# Advanced Security Scanning

Administrators can open **Security → Dependency, image and scheduled scans → Configure**. All three options default off, preserving the existing source security workflow until explicitly enabled. Policy is stored in `~/.ray/advanced-security/config.json`; `RAY_ADVANCED_SECURITY_DIR` overrides the root. New directories/files use 0700/0600.

## Scanner preparation

Install and verify a trusted Trivy release on the Brain host, available on Brain's PATH. This integration uses the CLI options documented for Trivy 0.68, JSON schema version 2, and local Docker sockets. Unsupported flags/schema, missing scanner/database, timeouts and malformed output are failures, not passing scans. No scanner binary or database is downloaded automatically by PutmeIn.

Prepare the private cache as the Brain service account, from a trusted working directory. With the default state location:

```sh
mkdir -p "$HOME/.ray/advanced-security/trivy-cache"
trivy image --download-db-only --cache-dir "$HOME/.ray/advanced-security/trivy-cache"
trivy image --download-java-db-only --cache-dir "$HOME/.ray/advanced-security/trivy-cache"
```

Use the configured root if overridden. Maintain database updates separately at least daily. These operator-run commands download advisory/index data. During application scans, PutmeIn disables database updates, dependency lookup API calls, version checks and telemetry. It rejects advisory metadata older than 48 hours or implausibly future-dated metadata. Java image analysis may also need the local Java index. A fresh cache timestamp is a freshness check, not cryptographic proof of database provenance; use trusted update sources.

Saving enabled vulnerability options requires Trivy and fresh advisory metadata. Inspect the cache and executable if enabling fails. The integration does not install packages or execute application build hooks. Trivy itself must be kept updated and run with appropriate host permissions.

References: [Trivy filesystem CLI](https://trivy.dev/docs/v0.68/guide/references/configuration/cli/trivy_filesystem/) and [Trivy image CLI](https://trivy.dev/docs/v0.68/guide/references/configuration/cli/trivy_image/).

## Dependency gate

When enabled, dependency analysis runs after the existing source analysis on every managed deployment, including incremental source scans. It also runs during manual and scheduled scans. Results affect the same report and gate; dependency findings affect the approval rules fingerprint so approvals cannot silently cover changed findings.

The scanner receives a temporary copy of allowlisted manifests/lockfiles: npm lockfiles, Yarn, pnpm, Poetry, uv, Pipenv, requirements.txt, Bundler, Composer, Go module/sum, Cargo, .NET package lock and Gradle lock files. Generated/dependency directories follow the existing source exclusions. No project scanner configuration or ignore file is used. Manifest symlinks are rejected; other symlinks are not traversed. Snapshot limits are 100,000 visited entries, 1,000 manifests, 10 MiB per manifest and 100 MiB combined. File identity is checked while reading, and deployment source fingerprints are checked before/after scanning.

Coverage depends on supported formats and resolved versions. Development dependencies are included where Trivy supports them. Unpinned requirements, missing lockfiles, unsupported ecosystems and files outside the allowlist are not a complete dependency inventory. No recognized manifest yields an explicit not-applicable log entry; no coverage is claimed. A scanner result without analyzed targets is incomplete and blocks an enabled check.

## Image gate and rescanning

When enabled and the global deployment security gate is on, a newly built image is inspected and scanned before the previous container is stopped. The application starts from the scanned immutable image ID, not a mutable tag. Retained Docker images are rescanned before explicit rollback. High/critical image findings and incomplete image scans block; source risk overrides do not bypass the image gate.

Image scanning uses only the locally resolved Docker Unix/named-pipe socket, without remote registry fallback or inherited registry credentials. Remote Docker endpoints are unsupported. Manual/scheduled image scans require a saved container ID and matching owner/project labels; unverifiable legacy containers report an incomplete scan. Host projects without Docker receive an explicit no-image-coverage note.

HIGH/CRITICAL map to danger, MEDIUM/UNKNOWN to warning, and LOW to info. Danger blocks managed deployment; warnings remain visible. Output is bounded to 8 MiB and 2,000 findings, with two-minute scanner deadlines, two scanner workers, and a 5 GB image limit. Exceeding a limit reports an incomplete scan. No CVE remediation, package update or rebuild is performed automatically.

## Scheduled rescans

Set an interval from 6 to 168 hours; zero disables scheduling. Brain checks policy every minute and processes at most five due projects per sweep. It includes enabled monitored projects, with a fail-closed maximum inventory of 2,000. Targets are re-resolved under the deployment lifecycle lock before scanning. Scans are serial, defer while managed deployment/cleanup is active, and may cause a concurrent deployment request to report busy until scanning finishes.

The scheduler runs source checks plus enabled Trivy checks independently of the deployment-gate switch. It does not stop applications or replace the successful-release source baseline. Failed scans are saved as error reports, and reports use the existing Security/Incidents/monitor-alert pipeline. Four-minute per-project deadlines apply; large backlogs or scans can make actual start times later than the configured interval.

Per-project timestamps and pending reports are stored under `schedules/` in the advanced-security root. Results are saved before delivery. Ray delivery failures retain the same report for retry after 15 minutes, avoiding duplicate report IDs and preventing a few unavailable deliveries from starving later targets. Disabling scheduling also pauses pending deliveries. Deleting/disabling a project removes it from future inventory; its retained pending file requires operator review. Corrupt state is preserved and logged. A crash during an unfinished scan causes it to be rerun; this is not a distributed scheduler. Local report history currently has no automatic pruning policy.

## File map and validation

| File | Responsibility |
| --- | --- |
| `brain/internal/security/advanced.go` | Global opt-in policy and private settings. |
| `brain/internal/security/trivy.go` | Bounded snapshots, scanner execution, report normalization and container ownership. |
| `brain/internal/deploy/security_gate.go` | Dependency findings in the pre-build gate. |
| `brain/internal/deploy/docker.go` | New-image gate before replacement. |
| `brain/internal/deploy/docker_transaction.go` | Rollback image verification. |
| `brain/internal/deploy/security_schedule.go` | Lifecycle-serialized schedules and pending report delivery. |
| `brain/internal/api/security_advanced.go` | Internally authenticated policy API. |
| `ray/app/api/security/advanced/route.ts` | Administrator authorization. |
| `ray/app/api/security/internal/targets/route.ts` | Internal current-project inventory. |
| `ray/src/components/AdvancedSecuritySettings.tsx` | Existing-design-system controls. |

Isolated fixtures cover severity normalization, stable finding IDs, environment isolation, symlink boundaries, stale-cache rejection and schedule timing/backoff. They do not certify real Trivy coverage or a production image scan. Review against representative projects, an installed scanner/cache, and Docker before enabling gates on production. Whole-program analysis, runtime exploit validation and automatic remediation remain outside this implementation.

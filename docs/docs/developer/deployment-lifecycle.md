---
title: Deployment Concurrency, Rollback and Cleanup
---

# Deployment concurrency, rollback and cleanup

Project settings include **Restore previous release**, **Recover interrupted deployment**, and **Preview cleanup**. These operations work through Brain and require an authenticated project owner in Ray.

## Concurrency

Brain uses a non-blocking, server-wide filesystem lock for managed deployments, lifecycle actions, recovery and cleanup. Another request receives a busy error and must retry; there is no deployment queue. Cancellation remains available while a deployment owns the lock.

All Brain processes controlling the same installation must share the same local lifecycle directory and Docker daemon. The default directory is `~/.ray/lifecycle`; override it with `RAY_LIFECYCLE_DIR`. This is not a distributed lock for multiple servers or a network filesystem.

Project deletion spans Ray filesystem and database work. It obtains a durable deletion reservation before making changes, blocking other managed lifecycle work until completion. Successful deletion records a project tombstone so a queued request cannot redeploy that deleted project ID.

If Ray exits during deletion, retry deletion of that same project to resume the reservation. If the project record is already gone, an administrator must inspect `deletion.json`, confirm no deletion worker is still running, and finish the reservation through the internally authenticated `POST /v1/deploy/action` endpoint with `action: "finish-delete"`, its `deletionToken`, and `completed: true`. Use `completed: false` only when deliberately abandoning an incomplete deletion. Never publish the token or delete the reservation while a worker might still be active.

Arbitrary terminal commands and external Docker tools are outside this coordination.

## Replacement and rollback

A Docker build gets a unique image tag. The existing container remains running during the build. Before replacement, Brain records a recovery journal, stops the previous container and renames it for retention. The new container becomes the active release only after startup health checks and routing succeed.

When replacement fails, Brain attempts to restore the retained container and routing. Recovery errors preserve the journal and block another replacement. A completed journal only needs its release indexes finalized; recovery does not undo an already committed release.

Docker-off deployments retain the prior source directory and runtime configuration. Their replacement also has a journal, health checks and failure recovery. Brain checks host journals during startup. Process identity checks protect against signalling unrelated processes.

Manual rollback restores the previous retained image or host build without rebuilding. It runs the current security gate first and does not reuse an old security override. A successful rollback keeps the replaced release as the next rollback target. Dashboard deployment status remains healthy when a failed attempt has explicitly restored that same deployment.

Important boundaries:

- Reusing the same port can interrupt traffic during replacement and recovery. This is not zero-downtime deployment.
- Rollback does not reverse migrations, writes to external services, volumes or other application side effects.
- Host runtime files must remain available and unmodified for their retained build to be usable.
- A host process start and its state-file write cannot be atomic. If Brain dies in that narrow interval, an unrecorded process may require operator inspection; recovery does not kill unknown processes.
- Containers created before release tracking may be recoverable during a replacement, but do not have a complete previous-release manifest for manual rollback.
- External container replacements that disagree with a saved manifest block automatic replacement until their state is reconciled.

## Release cleanup

Cleanup starts with a preview. Apply sends only the displayed paths; Brain checks eligibility again under the operation lock.

The policy preserves:

- The three newest tracked release records.
- All records younger than seven days.
- Active and previous releases, incomplete replacements and their source references.
- In-progress build records.
- The project's configured source location and overlapping protected directories.

Candidates must be recorded, owner-scoped snapshots beneath `.security-releases/<project identity>/release-*`. Symlinked or unrecognized source paths are skipped. Associated retired Docker containers must be stopped and ownership-labelled. Image removal is non-forced, so images still referenced by containers remain protected. No global Docker prune runs, and this cleanup never sweeps volumes or networks.

The preview size counts source files, not Docker layer disk usage. Partially unsuccessful cleanup preserves the source when container or image ownership/removal cannot be verified, and reports the error.

Older untracked uploads, Git checkouts, crashed build records and existing Docker resources without ownership labels require manual review. Cleanup deliberately leaves them alone. Failed images created by tracked attempts are recorded for later cleanup.

## Logs

New managed Docker containers use the `json-file` driver with `max-size=10m` and `max-file=3`. Existing containers need replacement before these options take effect.

New host starts use a dedicated per-application collector, launched from the Brain executable in an internal child mode. It owns stdout/stderr and survives the main Brain process exiting. It shares the application's verified process group, so managed stop/restart/recovery still controls the complete runtime. The collector bypasses platform settings and dotenv loading; the application receives only its configured host environment.

A host log location such as `application-<marker>.log` is now a private directory containing `format.json` and up to three segments of 10 MiB each. Segment names contain their absolute byte offsets. The collector creates a new segment and removes the oldest one as needed; it never copies/truncates an actively written file. This limits retained payload to 30 MiB per host start, plus small metadata and filesystem overhead.

Monitor reads use monotonic offsets across segments. If output exceeds retention before monitoring catches up, the next read includes an explicit skipped-byte warning. The dashboard's Brain reader and offline local fallback both understand this format and limit tail reads to 2 MiB. Segments may be pruned during a read; retrying reads the remaining retained data. This is bounded operational logging, not a lossless audit archive.

Already-running legacy processes keep their existing regular log file until restarted or redeployed; no application is automatically restarted to enable rotation. A new process start, including rollback recovery, adopts the collector. Use foreground start commands; a command that daemonizes is not a supported managed service.

If rotation or writing fails, the collector reports the failure to Brain's inherited stderr and stops its application group rather than silently continuing without logging. Managed shutdown permits a short drain before the existing forced-stop deadline. An external SIGKILL or machine failure can still interrupt buffered output.

Hourly maintenance removes unprotected retired host logs older than seven days. Both legacy files and recognized segmented directories are supported; directories with unknown entries or symlinks are preserved. Active, previous-release and recovery-journal log locations remain protected. Never use a generic file tail against a segmented directory; use Monitor, the deployment logs endpoint, or inspect its segment files.

Database build logs have the project-scoped cleanup described below.

## Database log history

Project settings → **Deployment log history** provides a separate preview and explicit clear action. This clears log text, never deployment or pipeline-run records. It is manual; no scheduled database cleanup is enabled.

The policy keeps the newest ten deployment records and newest ten CI/CD runs across the project's linked pipelines. Deployment logs qualify only when the record is failed or stopped and both its creation and last-update timestamps are more than 30 days old. CI/CD runs must be successful or failed and more than 30 days old. Healthy deployments, pending/building/deploying records and active or unknown run statuses are excluded.

Each preview reads up to 50 eligible records of each kind, ordered oldest first. Apply accepts only selected IDs and fingerprints, rechecks owner/project scope, age and protected records, then clears unchanged content in a serializable database transaction. Concurrent changes cause a skip or transaction failure; retry from a fresh preview. Deployment timestamps remain unchanged by cleanup.

CI/CD `logs` and each known stage's `logs` text are removed. Stage names, results, durations, commit metadata, deployment settings, application files and security reports remain. Malformed or unfamiliar stage formats are preserved and reported for manual review; such rows can occupy a bounded preview batch until reviewed. Sizes are UTF-8 log-text bytes, not a promise that the database immediately releases that amount of disk space.

The preview returns metadata and fingerprints, never log contents. This feature requires no schema migration. Pipeline-run age uses `createdAt`, because that table has no last-updated timestamp; a custom integration that reuses old run IDs should retain/export its logs separately.

## Files to extend

| File | Responsibility |
| --- | --- |
| `brain/internal/deploy/operations*.go` | Cross-process lifecycle lock |
| `brain/internal/deploy/deletion.go` | Multi-step project deletion reservation and tombstones |
| `brain/internal/deploy/docker_transaction.go` | Docker journal, previous release and rollback |
| `brain/internal/deploy/host_transaction.go` | Host replacement recovery and commit indexing |
| `brain/internal/deploy/retention.go` | Artifact tracking, eligibility, cleanup and retired host logs |
| `brain/internal/deploy/docker.go` | Unique images, replacement and Docker log limits |
| `brain/internal/deploy/host.go` | Host process lifecycle and supervision |
| `brain/internal/hostlogs/` | Independent collector, segment writer/readers and focused fixtures |
| `brain/internal/monitor/log_reader.go` | Monitoring and tail-reader integration |
| `ray/src/lib/local-log-tail.ts` | Bounded offline tail fallback for regular and segmented logs |
| `brain/internal/deploy/lifecycle_test.go` | Isolated lock, recovery and retention checks |
| `brain/internal/api/deploy.go` | Internal lifecycle action API |
| `ray/app/api/projects/[id]/releases/route.ts` | Authenticated project controls |
| `ray/src/components/ProjectReleaseControls.tsx` | Project recovery and release cleanup UI |
| `ray/src/lib/log-retention.ts` | Log retention policy constants, fingerprints and stage-log handling |
| `ray/src/lib/project-log-retention.ts` | Owner-scoped database eligibility and transactional cleanup |
| `ray/app/api/projects/[id]/log-retention/route.ts` | Authenticated log preview/clear API |
| `ray/src/components/ProjectLogRetention.tsx` | Database log-history controls |

Lifecycle manifests are private server state and can contain deployment environment values needed for recovery. They must never be returned directly to the browser or checked into source control. The release list exposes only path, creation time and status; artifact tracking strips environment values and Git credentials.

## Review on a disposable application

1. Start a deployment, then submit another lifecycle operation; verify it reports busy.
2. Deploy two healthy releases, then restore the first and verify its response and route.
3. Deploy a release with a failing health check; verify the previous application returns and the failed attempt remains visible in logs.
4. Interrupt a replacement and use recovery before retrying.
5. Preview cleanup; confirm active/previous sources are absent before applying.
6. Check Docker log limits on a newly created container and review host logs in Monitor.

Use an application without production data for interruption and rollback checks.

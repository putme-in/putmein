---
id: monitoring-rules
title: Monitoring Rules
slug: /developer/monitoring-rules
---

# Monitoring Rules

Monitoring consumes application output and produces project alerts. Security findings and runtime alerts are separate: a passing code scan does not mean a running application cannot fail.

## File map

| File | Responsibility |
| --- | --- |
| `brain/internal/monitor/log_rules.go` | Deterministic runtime failure signatures. |
| `brain/internal/monitor/log_reader.go` | Log-file discovery, file tails, Docker timestamp cursors, and PM2/systemd log commands. |
| `brain/internal/monitor/monitor.go` | Project registration, polling, rule cooldowns, AI analysis, alert persistence, and broadcasts. |
| `brain/internal/monitor/types.go` | Project, alert, severity, and subscription types. |
| `brain/internal/monitor/process_manager.go` | Managed application processes and captured output. |
| `brain/internal/monitor/diagnose.go` | Log diagnosis and classification. |
| `brain/internal/monitor/memory.go` | Project context analysis. |
| `brain/internal/api/monitor.go` | Brain monitoring API and log retrieval. |
| `ray/app/api/monitor/` | Ray project, alert, process, and stream endpoints. |
| `ray/app/api/monitor/internal/add-project/route.ts` | Authenticated Brain-to-Ray registration callback. |
| `ray/app/(dashboard)/monitor/` | Monitoring overview and project detail screens. |
| `ray/prisma/schema.prisma` | `RayMonitorProject` and `RayMonitorAlert` persistence models. |

## Add an error signature

Extend `LogRules` with a stable ID, Go regular expression, severity, and a short actionable message. For example:

```go
{"dependency-timeout", regexp.MustCompile(`(?i)database connection timed out`),
    SeverityWarn, "Database connection timed out"},
```

Use specific expressions rather than matching every occurrence of “error”. Go's regular expressions use RE2 syntax. Monitoring severities are `info`, `warn`, `error`, and `critical`—note that `warn` differs from the security scanner's `warning`.

Recognized failures generate alerts without an AI provider. Repeated matches have a five-minute cooldown per rule and project, held in memory. Logs without a deterministic match continue through the existing AI analysis path.

Docker deployments register `docker:<container-name>` as a source for application stdout/stderr. File logs are discovered separately. Process listings are not application logs. Docker polling currently reads a bounded tail of 1,000 lines per window; this is not lossless centralized log storage.

## Per-project customization

Open **Project settings → Monitoring rules and loggers**. Configure built-in signatures, AI fallback, polling interval, alert cooldown, up to 32 custom RE2 rules, and up to ten extra log files. Preview sample text before saving; preview neither creates alerts nor changes settings. Saved settings are picked up on a subsequent poll without restarting the application.

Custom rules have a stable ID, pattern, message, severity, enable switch and optional cooldown. The default cooldown is 300 seconds; supported values are 10–86,400 seconds. Rule cooldown zero inherits the project default. Polling accepts 10–3,600 seconds, or zero to use the existing project interval; scheduling uses ten-second ticks. Cooldowns are in memory and reset when the monitor restarts. RE2 does not support lookbehind or backreferences.

Extra files must exist inside the current project directory, including after redeployment. Absolute paths, parent traversal and symlinks escaping that directory are rejected or ignored. These fields do not execute shell commands. Container applications should write to stdout/stderr.

Enable JSON logging to map level values to alert severities and choose message/level fields. Dotted paths support nested objects. For numeric log levels use string keys, for example `{"50":"error","60":"critical"}`. Docker timestamp prefixes are supported. Each polling batch emits at most one JSON match per severity. JSON records must be complete within the bounded text collected in a poll; this is not a lossless log ingestion service.

Settings are stored atomically with private file permissions under `~/.ray/monitor-configs`, overridable by `RAY_MONITOR_CONFIG_DIR`. File names hash owner and project IDs. Back up this directory alongside application state. Invalid configuration falls back to built-in detection, disables AI for that poll, and reports a configuration warning. Avoid credentials in logs: alert raw-log storage can contain original output, and enabled AI fallback sends unmatched output to the configured provider.

| File | Responsibility |
| --- | --- |
| `brain/internal/monitor/config.go` | Validation, private persistence, custom rules and structured logger parsing. |
| `brain/internal/api/monitor_config.go` | Internally authenticated get/save/preview API. |
| `ray/app/api/projects/[id]/monitoring/route.ts` | Project ownership checks and Brain proxy. |
| `ray/src/components/ProjectMonitoringSettings.tsx` | Existing-design-system settings and preview controls. |


## Dashboard incidents and persistence

The dashboard starts with **Needs attention**, now combining runtime alerts, deployment failures and security scans. See [Unified Incidents](./incidents.md) for inventory limits, handling states, history and source-screen behavior. Refresh failures remain visible and do not imply that the system is healthy.

Brain saves alerts into its local durable outbox before broadcasting them; a background worker delivers them through the authenticated Ray callback. Browser SSE connections only relay events, so closing the browser does not stop persistence and multiple tabs do not duplicate records. Each event has a UUID; up to three bounded HTTP attempts reuse it and Ray upserts it. Restart Brain and Ray together when upgrading this callback contract. No database migration is required.

Database delivery depends on Ray availability, but failed events remain on disk and are retried after recovery or restart. The unified incident view links back to the underlying monitoring, deployment and security records. Email and browser push notifications are not part of this change.

Implementation: `brain/internal/monitor/persistence.go`, `ray/app/api/monitor/alerts/[id]/route.ts`, `ray/app/api/monitor/stream/route.ts`, `ray/app/api/dashboard/incidents/route.ts`, and `ray/src/components/DashboardIncidents.tsx`.

## Durable alert outbox

`brain/internal/monitor/outbox.go` stores pending events in `~/.ray/alert-outbox`, or `RAY_ALERT_OUTBOX_DIR`. Use a persistent local filesystem and one Brain process per queue directory. Directory permissions are 0700 and event files are 0600; they contain application log excerpts, so include this private directory in protected backups.

Enqueue writes and syncs a temporary file, renames it, then syncs the directory before reporting success. A background worker runs at startup and every 15 seconds, attempting up to 100 events per batch. HTTP delivery uses bounded retries with the same UUID. Ray upserts by event ID and preserves the original detection timestamp. A crash after database acceptance but before local removal safely replays the same event. Live streams can announce a locally queued event before it appears in database-backed dashboard lists.

Rejected events—including deleted-project responses—and malformed files are preserved and logged for operator review. Batches advance through the queue so rejected entries do not permanently block later events. Review Brain logs when the backlog persists; fix credentials/database availability or archive obsolete events manually after review. Interrupted `.pending-*` files are not delivered automatically and require operator review.

The directory is limited to 10,000 entries and each event to 64 KiB (roughly 625 MiB maximum event content, plus filesystem overhead). A full/unwritable queue returns an error; no successful persistence or alert cooldown is claimed. This protects events successfully enqueued, not logs lost before detection, disk loss, or new events rejected due to capacity. There is no automatic expiry of undelivered alerts. Outbox status is currently reported through Brain logs, not a dashboard administration screen.

Focused fixtures cover offline delivery, restart replay, stable identity/timestamps, private permissions, invalid-entry preservation and collision rejection. No production queue or database was used during verification.

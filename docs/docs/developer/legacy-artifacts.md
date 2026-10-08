---
id: legacy-artifacts
title: Legacy Artifact Review
slug: /developer/legacy-artifacts
---

# Legacy Artifact Review

Administrators can open **Project settings → Legacy artifact review** to inspect older artifacts across the server. Review does not remove anything. Ordinary project members cannot access this server-wide operation.

## Review and cleanup

The review inventories upload staging, Git setup sources, pipeline releases, security staging, Ray Docker containers/images and previously quarantined folders. Sources without reliable ownership remain manual-review items. Arbitrary directories outside these staging layouts, Docker volumes and networks are never removed by this feature.

Known project paths, saved setup sources, runtime manifests, tracked releases, current/recent deployments and Docker mounts protect artifacts. Source folders must have no changes within 30 days, and the newest three per known project are retained. Missing Docker inspection, malformed manifests or inventory limits block cleanup rather than returning a partial eligible list.

Eligible sources first move to `.legacy-quarantine` inside the deployment directory. A private journal records their original location before moving. **Restore** refuses to overwrite an existing destination. Permanent removal is a separate confirmation and is unavailable until seven days after quarantine. Stopped containers and unused images need reliable ownership and a 30-day age; their removal is non-forced and does not remove volumes.

Every action repeats review and compares metadata fingerprints. Source moves/deletions additionally check open files with `lsof` and recheck the fingerprint. Brain serializes operations with the deployment lifecycle lock. Run Brain with sufficient process visibility for `lsof`; avoid concurrent manual host changes during cleanup. The lock coordinates platform operations, not arbitrary external processes, and fingerprints are metadata checks rather than full content hashes.

If a quarantine journal reports an interrupted operation, restore it where available. Missing sources or invalid journals require operator inspection of `record.json` and the original/source paths; do not delete journals blindly. Quarantine lives on the same filesystem to permit atomic directory renames. Keep backups independently.

## Implementation

| File | Responsibility |
| --- | --- |
| `brain/internal/deploy/legacy.go` | Inventory, protections, fingerprints, quarantine, restore and non-forced Docker removal. |
| `brain/internal/api/legacy.go` | Internally authenticated lifecycle-locked operation endpoint. |
| `ray/app/api/maintenance/legacy-artifacts/route.ts` | Administrator authorization and server-derived ownership/reference inventory. |
| `ray/src/components/LegacyArtifactReview.tsx` | Review, reversible actions and permanent-removal confirmation. |

Browser input cannot supply trusted ownership or protection references. Ray derives them from the database and setup records. Large installations exceeding bounded inventory limits require manual review. Tracked release cleanup remains separate; see [Concurrency, Rollback & Cleanup](./deployment-lifecycle.md).

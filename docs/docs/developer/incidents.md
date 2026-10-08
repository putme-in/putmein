---
id: incidents
title: Unified Incidents
slug: /developer/incidents
---

# Unified Incidents

The dashboard's **Needs attention** section and the **Incidents** sidebar page combine runtime monitor alerts, failed deployment attempts and security scans with warning, danger or error status. Filter by source and handling state, inspect the underlying record, and acknowledge, dismiss or reopen an incident.

## Meaning of handling states

- **Open:** needs review.
- **Acknowledged:** reviewed or being investigated; remains in the active list.
- **Dismissed:** hidden from the active incident list; available through filters and reversible with Reopen.

These states describe handling, not remediation. They do not change deployment health, approve security risks, delete records, or suppress future monitoring events. Handling state is independent of the source screens: dismissing an incident does not alter the monitor alert's dismissal flag or its source badge. Existing monitor dismissals seed incident state until explicitly handled; changes to that source flag invalidate older handling evidence.

Each failed attempt and adverse scan remains a historical incident until handled; a later successful deployment or passed scan does not automatically close older records. Risk-overridden danger findings stay critical and show that an override was recorded. A scan's synthetic monitor alert is hidden only when its matching scan is present in the same inventory; unmatched alerts remain visible.

## Inventory and navigation

The server loads up to 300 newest records per source (all monitor alerts, failed deployments, and adverse scans), without raw logs or full findings. Sorting is by severity, newest first within a severity. Counts cover this bounded inventory. A visible warning appears if any source exceeds the limit. Older evidence remains accessible in source pages; this is not a global count or lossless historical search.

The dashboard paginates eight rows; the dedicated page paginates 25. Both refresh every 15 seconds while visible, retain stale results with an error when refresh fails, and support the same actions. Security links fetch the exact scan through an owner-scoped endpoint and open its report, even when it is outside the Security page's latest list.

## State storage and conflicts

Handling records live outside project code in `~/.ray/incident-states`, or `RAY_INCIDENT_STATE_DIR`. File names hash the signed-in owner and source identity; directories use 0700 and new state files use 0600. Back up this directory with platform settings. No database migration is required.

Each state record contains a revision, source-evidence fingerprint and the latest 20 handling transitions with timestamps. Changed source evidence resets the effective handling state, preserving prior history. This is a bounded review history, not a full audit archive. Identity is owner-scoped; it is not a shared multi-user incident assignment system.

Updates recheck source ownership and fingerprint, require the displayed revision, and take an exclusive per-record filesystem lock before atomic replacement. Stale views and concurrent writes receive a conflict and must refresh. Corrupt state blocks the overview instead of silently resetting dismissals. An interrupted writer can leave a `.lock` file: stop the relevant Ray writer and inspect the state before manually removing a confirmed abandoned lock. Do not remove locks from active writers. Use a filesystem with reliable exclusive-create/rename semantics.

## File map

| File | Responsibility |
| --- | --- |
| `ray/src/lib/incident-sources.ts` | Owner-scoped source inventory, evidence fingerprints and duplicate suppression. |
| `ray/src/lib/incident-store.ts` | Private state persistence, bounded history and optimistic concurrency. |
| `ray/src/lib/incidents.ts` | Shared types, severity ordering and counts. |
| `ray/app/api/dashboard/incidents/route.ts` | Authenticated inventory and handling updates. |
| `ray/src/components/DashboardIncidents.tsx` | Shared dashboard/full-page interaction. |
| `ray/app/(dashboard)/incidents/page.tsx` | Dedicated incident page. |
| `ray/app/api/security/scans/[id]/route.ts` | Owner-scoped exact scan retrieval. |

Fixtures cover ownership-scoped state, stale revisions, changed evidence, duplicate suppression, ordering and counts. Live database/UI review remains necessary. Email/browser delivery, assignments, automatic remediation and broader historical search are separate work.

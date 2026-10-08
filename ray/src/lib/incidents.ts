export type IncidentState = "open" | "acknowledged" | "dismissed";
export type IncidentKind = "runtime" | "deployment" | "security";
export type Incident = {
  id: string; kind: IncidentKind; sourceId: string; fingerprint: string;
  severity: string; title: string; projectName: string; createdAt: string; href: string;
  state: IncidentState; revision: number; history: { state: IncidentState; at: string }[];
};
export const incidentPriority: Record<string, number> = { critical: 0, vulnerable: 0, error: 1, warn: 2, info: 3 };
export function compareIncidents(a: Incident, b: Incident) {
  return (incidentPriority[a.severity] ?? 4) - (incidentPriority[b.severity] ?? 4) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}
export function incidentCounts(items: Incident[]) {
  const counts = { open: 0, acknowledged: 0, dismissed: 0, runtime: 0, deployment: 0, security: 0 };
  for (const item of items) { counts[item.state]++; counts[item.kind]++; }
  return counts;
}

import "server-only";
import prisma from "./prisma";
import { createHash } from "crypto";
import type { Incident, IncidentKind } from "./incidents";
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const base = (kind: IncidentKind, id: string, createdAt: Date): Incident => ({ id: `${kind}:${id}`, kind, sourceId: id, fingerprint: "", createdAt: createdAt.toISOString(), severity: "error", title: "", projectName: "", href: "", state: "open", revision: 0, history: [] });
export async function loadIncidentSources(owner: string, selected?: { kind: IncidentKind; id: string }) {
  const limit = selected ? 1 : 301;
  const [alerts, deployments, scans] = await Promise.all([
    !selected || selected.kind === "runtime" ? prisma.rayMonitorAlert.findMany({ where: { project: { userId: owner }, ...(selected ? { id: selected.id } : {}) }, take: limit, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, severity: true, message: true, dismissed: true, createdAt: true, projectId: true, project: { select: { name: true } } } }) : [],
    !selected || selected.kind === "deployment" ? prisma.rayDeployment.findMany({ where: { userId: owner, status: "failed", ...(selected ? { id: selected.id } : {}) }, take: limit, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, name: true, status: true, createdAt: true, updatedAt: true } }) : [],
    !selected || selected.kind === "security" ? prisma.raySecurityScan.findMany({ where: { userId: owner, status: { in: ["danger", "warning", "error"] }, ...(selected ? { id: selected.id } : {}) }, take: limit, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, projectName: true, status: true, dangerCount: true, warnCount: true, overridden: true, createdAt: true, updatedAt: true } }) : [],
  ]);
  const scanIds = new Set(scans.slice(0, 300).map(scan => `security_${scan.id}`));
  const items: Incident[] = [];
  for (const alert of alerts.slice(0, 300)) {
    // Hide only a known duplicate whose scan is actually present in this inventory.
    if (scanIds.has(alert.id)) continue;
    items.push({ ...base("runtime", alert.id, alert.createdAt), severity: alert.severity, title: alert.message.slice(0, 1000), projectName: alert.project.name,
      href: `/monitor/${encodeURIComponent(alert.projectId)}`, state: alert.dismissed ? "dismissed" : "open", fingerprint: fingerprint([alert.id, alert.createdAt, alert.dismissed]) });
  }
  for (const deployment of deployments.slice(0, 300)) items.push({ ...base("deployment", deployment.id, deployment.createdAt), title: "Failed deployment attempt", projectName: deployment.name,
    href: `/deployments/${encodeURIComponent(deployment.id)}`, fingerprint: fingerprint([deployment.id, deployment.status, deployment.updatedAt]) });
  for (const scan of scans.slice(0, 300)) items.push({ ...base("security", scan.id, scan.createdAt), severity: scan.status === "warning" ? "warn" : "critical",
    title: scan.status === "error" ? "Security scan could not complete" : `Security scan: ${scan.dangerCount} danger, ${scan.warnCount} warning findings${scan.overridden ? " (risk override recorded)" : ""}`,
    projectName: scan.projectName, href: `/security?scanId=${encodeURIComponent(scan.id)}`, fingerprint: fingerprint([scan.id, scan.status, scan.updatedAt, scan.dangerCount, scan.warnCount, scan.overridden]) });
  return { items, truncated: alerts.length > 300 || deployments.length > 300 || scans.length > 300 };
}

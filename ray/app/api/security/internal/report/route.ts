import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import prisma from "@/lib/prisma";
export async function POST(req: NextRequest) {
  const expected = Buffer.from(process.env.BRAIN_INTERNAL_SECRET || "");
  const supplied = Buffer.from(req.headers.get("x-brain-secret") || "");
  if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { userId, report } = await req.json();
    if (typeof userId !== "string" || !report || !/^scan_\d+$/.test(report.id) || typeof report.projectName !== "string" || !["passed", "warning", "danger", "error", "skipped"].includes(report.status) || !Array.isArray(report.findings)) return NextResponse.json({ error: "Invalid report" }, { status: 400 });
    const data = { userId, projectId: report.projectId || null, projectName: report.projectName, trigger: ["deployment_gate", "image_gate", "scheduled"].includes(report.trigger) ? report.trigger : "deployment_gate", status: report.status,
      dangerCount: report.dangerCount || 0, warnCount: report.warnCount || 0, infoCount: report.infoCount || 0, findings: JSON.stringify(report.findings),
      logs: report.logs || report.summary || "", overridden: report.overridden === true };
    // Idempotent retries must not cross owner boundaries.
    const existing = await prisma.raySecurityScan.findUnique({ where: { id: report.id } });
    if (existing && existing.userId !== userId) return NextResponse.json({ error: "Report identity conflict" }, { status: 409 });
    await prisma.raySecurityScan.upsert({ where: { id: report.id }, create: { id: report.id, ...data }, update: data });
    const project = report.projectId ? await prisma.rayMonitorProject.findFirst({ where: { id: report.projectId, userId }, select: { id: true } }) : null;
    if (project && ["danger", "error", "warning"].includes(report.status)) {
      const alertId = `security_${report.id}`;
      await prisma.rayMonitorAlert.upsert({ where: { id: alertId }, update: {}, create: {
        id: alertId, projectId: project.id, severity: report.status === "warning" || report.overridden ? "warn" : "critical",
        message: `Security ${report.overridden ? "risk approved" : report.status === "danger" || report.status === "error" ? "blocked deployment" : "review needed"}: ${report.projectName}. ${report.summary || "Open Security to review the scan."}`,
        rawLog: `Security scan ${report.id}. ${report.summary || ""}`,
      } });
    }
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Could not persist security report" }, { status: 500 }); }
}

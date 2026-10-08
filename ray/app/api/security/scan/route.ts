import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";
export const maxDuration = 300;
export async function POST(req: NextRequest) {
  const token = (await cookies()).get("ray_token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const project = await prisma.rayMonitorProject.findFirst({ where: { userId: user.userId, ...(body.projectId ? { id: body.projectId } : { projectPath: typeof body.projectPath === "string" ? body.projectPath : "" }) } });
    if (!project) return NextResponse.json({ error: "Choose a project you own." }, { status: 404 });
    const deployment = await prisma.rayDeployment.findFirst({ where: { userId: user.userId, projectId: project.id, status: "healthy" }, orderBy: { createdAt: "desc" }, select: { containerId: true } });
    let report;
    try {
      const response = await fetch(`${BRAIN_URL}/v1/security/scan`, { method: "POST", headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
        body: JSON.stringify({ userId: user.userId, projectId: project.id, projectName: project.name, projectPath: project.projectPath, containerId: deployment?.containerId || "", trigger: "manual" }), signal: AbortSignal.timeout(245000) });
      if (!response.ok) throw new Error();
      report = (await response.json()).report;
      if (!report || !["passed", "warning", "danger", "error"].includes(report.status) || !Array.isArray(report.findings)) throw new Error();
    } catch {
      report = { status: "error", dangerCount: 0, warnCount: 0, infoCount: 0, findings: [], logs: "Manual scan did not complete. Check Brain availability, source access and scanner limits. No passing result was recorded." };
    }
    const scan = await prisma.raySecurityScan.create({ data: { userId: user.userId, projectId: project.id, projectName: project.name, trigger: "manual", status: report.status, dangerCount: report.dangerCount || 0,
      warnCount: report.warnCount || 0, infoCount: report.infoCount || 0, findings: JSON.stringify(report.findings), logs: report.logs || "" } });
    return NextResponse.json({ ok: report.status !== "error", scan, report, ...(report.status === "error" ? { error: "Scan did not complete; the failure has been recorded." } : {}) }, { status: report.status === "error" ? 502 : 200 });
  } catch { return NextResponse.json({ error: "Could not save the security scan." }, { status: 500 }); }
}

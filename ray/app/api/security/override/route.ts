import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHmac } from "crypto";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
export async function POST(req: NextRequest) {
  const token = (await cookies()).get("ray_token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    if (body.acknowledgedRisk !== true || body.consentDeploy !== true) return NextResponse.json({ error: "Acknowledge the findings and confirm deployment." }, { status: 400 });
    const run = await prisma.rayPipelineRun.findFirst({ where: { id: body.pipelineRunId, pipeline: { userId: user.userId }, status: "blocked_danger" }, include: { pipeline: true } });
    const scan = typeof body.scanId === "string" ? await prisma.raySecurityScan.findFirst({ where: { id: body.scanId, userId: user.userId, status: "danger", trigger: "deployment_gate" } }) : null;
    if (!run || !scan || !run.logs?.includes(`[SECURITY_SCAN] ${scan.id}\n`)) return NextResponse.json({ error: "Choose the blocking scan belonging to this pipeline run." }, { status: 409 });
    const metadataLine = scan.logs.split("\n").find(line => line.startsWith("[SECURITY_GATE] "));
    const metadata = metadataLine ? JSON.parse(metadataLine.slice("[SECURITY_GATE] ".length)) : null;
    if (!metadata || !/^[a-f0-9]{64}$/.test(metadata.tree) || !/^[a-f0-9]{64}$/.test(metadata.rules) || metadata.projectId !== scan.projectId) return NextResponse.json({ error: "This scan cannot authorize a source-bound override. Run the pipeline again." }, { status: 409 });
    const secret = process.env.BRAIN_INTERNAL_SECRET;
    if (!secret) throw new Error("Internal authentication is unavailable");
    const payload = Buffer.from(JSON.stringify({ user: user.userId, project: scan.projectId, tree: metadata.tree, rules: metadata.rules, expires: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
    const securityOverride = `${payload}.${createHmac("sha256", secret).update(`ray-security-override:v1:${payload}`).digest("base64url")}`;
    const { executePipelineRun } = await import("@/lib/cicd-runner");
    const claimed = await prisma.$transaction(async tx => {
      const result = await tx.rayPipelineRun.updateMany({ where: { id: run.id, status: "blocked_danger" }, data: { status: "running", logs: (run.logs || "") + "\n[OVERRIDE] Risk approved for the reviewed source and rules only. Changed source will be gated again.\n" } });
      if (result.count === 1) await tx.raySecurityScan.update({ where: { id: scan.id }, data: { overridden: true, overrideBy: user.name || user.email } });
      return result.count;
    });
    if (claimed !== 1) return NextResponse.json({ error: "This run is already being resumed." }, { status: 409 });
    void executePipelineRun({ pipelineId: run.pipelineId, runId: run.id, userId: user.userId, securityOverride, overrideAuthor: user.name || user.email }).catch(() => {});
    return NextResponse.json({ ok: true, message: "Approved for this source snapshot. The pipeline will scan again before deployment." });
  } catch { return NextResponse.json({ error: "Could not authorize the reviewed deployment." }, { status: 500 }); }
}

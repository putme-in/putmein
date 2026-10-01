import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

// POST /api/security/scan — runs a security audit via Brain and saves the scan record to MySQL
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const {
      projectId,
      projectName,
      projectPath,
      gitDiff,
      trigger = "manual",
      modelId,
    } = body;

    if (!projectName || !projectPath) {
      return NextResponse.json({ error: "projectName and projectPath are required" }, { status: 400 });
    }

    // Call Brain security scanner
    const bRes = await fetch(`${BRAIN_URL}/v1/security/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "",
      },
      body: JSON.stringify({
        projectId,
        projectName,
        projectPath,
        gitDiff,
        trigger,
        modelId,
      }),
      // Brain's AI client allows up to 120s for a complete audit response.
      // Keep the gateway timeout aligned so a slow but valid scan can still be persisted.
      signal: AbortSignal.timeout(120000),
    });

    if (!bRes.ok) {
      const errText = await bRes.text().catch(() => "Security service error");
      return NextResponse.json({ error: `Security scan failed: ${errText}` }, { status: 502 });
    }

    const data = await bRes.json();
    const report = data.report;

    if (!report) {
      return NextResponse.json({ error: "Empty report returned from security service" }, { status: 502 });
    }

    // Persist scan in MySQL via Prisma
    const savedScan = await prisma.raySecurityScan.create({
      data: {
        userId: user.userId,
        projectId: projectId || null,
        projectName: projectName,
        trigger: trigger,
        status: report.status || "passed",
        dangerCount: report.dangerCount || 0,
        warnCount: report.warnCount || 0,
        infoCount: report.infoCount || 0,
        findings: JSON.stringify(report.findings || []),
        logs: report.logs || "",
      },
    });

    return NextResponse.json({ ok: true, scan: savedScan, report });
  } catch (err: unknown) {
    console.error("POST /api/security/scan error:", err);
    return NextResponse.json({ error: (err as Error).message || "Server error" }, { status: 500 });
  }
}

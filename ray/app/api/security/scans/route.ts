import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

// GET /api/security/scans — lists security audit records with stats
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");

    const whereClause: any = { userId: user.userId };
    if (projectId) {
      whereClause.projectId = projectId;
    }

    const scans = await prisma.raySecurityScan.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // Compute aggregate statistics
    let totalDanger = 0;
    let totalWarn = 0;
    let totalClean = 0;

    // Get latest scan per project
    const latestPerProject = new Map<string, any>();
    for (const scan of scans) {
      const pKey = scan.projectId || scan.projectName;
      if (!latestPerProject.has(pKey)) {
        latestPerProject.set(pKey, scan);
        if (scan.status === "danger") totalDanger++;
        else if (scan.status === "warning") totalWarn++;
        else if (scan.status === "passed") totalClean++;
      }
    }

    // Check for any currently blocked pipeline runs
    const blockedPipelines = await prisma.rayPipelineRun.findMany({
      where: {
        pipeline: { userId: user.userId },
        status: "blocked_danger",
      },
      include: {
        pipeline: true,
      },
      take: 10,
    });

    return NextResponse.json({
      scans,
      stats: {
        totalScans: scans.length,
        totalProjects: latestPerProject.size,
        cleanProjects: totalClean,
        warningProjects: totalWarn,
        dangerProjects: totalDanger,
        blockedDeployments: blockedPipelines.length,
      },
      blockedPipelines,
    });
  } catch (err: unknown) {
    console.error("GET /api/security/scans error:", err);
    return NextResponse.json({ error: (err as Error).message || "Server error" }, { status: 500 });
  }
}

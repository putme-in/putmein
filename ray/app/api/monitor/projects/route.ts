import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

// GET /api/monitor/projects — list user's monitored projects
export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projects = await prisma.rayMonitorProject.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { alerts: { where: { dismissed: false } } } },
      },
    });

    return NextResponse.json({ projects });
  } catch (err) {
    console.error("GET /api/monitor/projects:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/monitor/projects — add a new monitored project
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { name, projectPath, logCommand, intervalSec = 30, projectUrl } = body;

    if (!name || !projectPath) {
      return NextResponse.json(
        { error: "name and projectPath are required" },
        { status: 400 }
      );
    }

    // 1. Tell Brain to start monitoring (it discovers log paths and — if BRAIN_INTERNAL_SECRET
    //    is set — also persists the project via /api/monitor/internal/add-project).
    let brainProjectId: string | null = null;
    let logPaths: string[] = [];
    let status = "discovering";
    try {
      const brainRes = await fetch(`${BRAIN_URL}/v1/monitor/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
        body: JSON.stringify({ userId: user.userId, name, projectPath, logCommand, intervalSec }),
        signal: AbortSignal.timeout(15000),
      });
      if (brainRes.ok) {
        const brainData = await brainRes.json();
        if (brainData.project?.id) brainProjectId = brainData.project.id as string;
        if (brainData.project?.logPaths) logPaths = brainData.project.logPaths as string[];
        if (brainData.project?.status) status = brainData.project.status as string;
      }
    } catch {
      // Brain offline — still persist in DB; brain will pick up on restart
      console.warn("Brain offline, persisting monitor project in DB only");
    }

    // 2. If Brain already persisted via the internal callback (brainProjectId exists in DB),
    //    just return that existing record — do NOT create a second one.
    if (brainProjectId) {
      const existing = await prisma.rayMonitorProject.findFirst({
        where: { id: brainProjectId, userId: user.userId },
      });
      if (existing) {
        // Update projectUrl if provided (internal callback doesn't set it)
        if (projectUrl) {
          const updated = await prisma.rayMonitorProject.update({
            where: { id: brainProjectId },
            data: { projectUrl },
          });
          return NextResponse.json({ project: updated }, { status: 201 });
        }
        return NextResponse.json({ project: existing }, { status: 201 });
      }
    }

    // 3. Brain was offline or didn't have a secret — create the DB row ourselves
    const project = await prisma.rayMonitorProject.create({
      data: {
        userId: user.userId,
        name,
        projectPath,
        logPaths: JSON.stringify(logPaths),
        logCommand: logCommand || null,
        projectUrl: projectUrl || null,
        intervalSec,
        enabled: true,
        status,
      },
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    console.error("POST /api/monitor/projects:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

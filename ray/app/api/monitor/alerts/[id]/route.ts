import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

// Also handles POST to create alerts (called by Brain's callback when it detects one)
// DELETE /api/monitor/alerts/[id] — dismiss an alert

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Verify ownership via project → user chain
    const alert = await prisma.rayMonitorAlert.findFirst({
      where: { id },
      include: { project: { select: { userId: true } } },
    });
    if (!alert || alert.project.userId !== user.userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.rayMonitorAlert.update({
      where: { id },
      data: { dismissed: true },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/monitor/alerts/[id]:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/monitor/alerts/[id] — Brain calls this to persist a detected alert
// (id is the projectId here, not alertId)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const expected = process.env.BRAIN_INTERNAL_SECRET;
    if (!expected || req.headers.get("x-brain-secret") !== expected) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: projectId } = await params;
    const body = await req.json();
    const { severity, message, rawLog, id, createdAt } = body;
    const detectedAt = typeof createdAt === "string" ? new Date(createdAt) : new Date();
    if (!Number.isFinite(detectedAt.getTime()) || detectedAt.getTime() > Date.now() + 300000) return NextResponse.json({ error: "Invalid detection time" }, { status: 400 });
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return NextResponse.json({ error: "Valid event ID required" }, { status: 400 });

    if (!["info", "warn", "error", "critical", "vulnerable"].includes(severity) || typeof message !== "string" || !message.trim() || message.length > 4000 || (rawLog != null && (typeof rawLog !== "string" || rawLog.length > 32768))) {
      return NextResponse.json({ error: "severity and message required" }, { status: 400 });
    }

    // Verify project exists
    const project = await prisma.rayMonitorProject.findFirst({ where: { id: projectId } });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const existing = await prisma.rayMonitorAlert.findUnique({ where: { id }, select: { projectId: true } });
    if (existing && existing.projectId !== projectId) return NextResponse.json({ error: "Event conflict" }, { status: 409 });
    const alert = await prisma.rayMonitorAlert.upsert({
      where: { id }, update: {},
      create: { id, projectId, severity, message, rawLog: rawLog || "", createdAt: detectedAt },
    });

    return NextResponse.json({ alert }, { status: 201 });
  } catch (err) {
    console.error("POST /api/monitor/alerts/[id]:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

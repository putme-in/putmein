import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { readLocalLogTail } from "@/lib/local-log-tail";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

// GET /api/monitor/projects/[id]/logs?lines=100
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const token = cookieStore.get("ray_token")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await verifyToken(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const lines = parseInt(req.nextUrl.searchParams.get("lines") || "100", 10) || 100;

  // Fetch project from DB
  const project = await prisma.rayMonitorProject.findFirst({
    where: { id, userId: user.userId },
    select: { id: true, name: true, logPaths: true, managedLogFile: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const targetPath = project.managedLogFile || "";
  let brainLogs: { path: string; content?: string; error?: string }[] = [];

  // Try fetching from Brain first
  try {
    const brainUrl = new URL(`${BRAIN_URL}/v1/monitor/projects/${id}/logs`);
    brainUrl.searchParams.set("lines", String(lines));
    if (targetPath) brainUrl.searchParams.set("path", targetPath);

    const res = await fetch(brainUrl.toString(), {
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      brainLogs = (data.logs || []) as { path: string; content?: string; error?: string }[];
    }
  } catch {
    // Brain unavailable, fallback to local read
  }

  // If we have managedLogFile and Brain didn't provide content for it, read locally
  if (targetPath) {
    const existing = brainLogs.find((f) => f.path === targetPath);
    if (!existing || (!existing.content && !existing.error)) {
      try {
        const content = await readLocalLogTail(targetPath, lines);
        if (existing) {
          existing.content = content;
        } else {
          brainLogs.unshift({ path: targetPath, content });
        }
      } catch (err: unknown) {
        if (!existing) {
          brainLogs.unshift({ path: targetPath, error: err instanceof Error ? err.message : "File not found" });
        }
      }
    }
  }

  // Also check other log paths from DB if needed
  const dbLogPaths: string[] = (() => {
    try { return JSON.parse(project.logPaths || "[]") as string[]; } catch { return []; }
  })();

  for (const p of dbLogPaths) {
    if (!brainLogs.some((l) => l.path === p)) {
      try {
        const content = await readLocalLogTail(p, lines);
        brainLogs.push({ path: p, content });
      } catch {
        // silent
      }
    }
  }

  return NextResponse.json({
    projectId: id,
    name: project.name,
    logs: brainLogs,
  });
}

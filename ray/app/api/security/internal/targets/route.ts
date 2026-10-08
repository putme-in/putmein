import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import prisma from "@/lib/prisma";
export async function GET(req: Request) {
  const expected = Buffer.from(process.env.BRAIN_INTERNAL_SECRET || "");
  const supplied = Buffer.from(req.headers.get("x-brain-secret") || "");
  if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const projectId = new URL(req.url).searchParams.get("projectId");
    const projects = await prisma.rayMonitorProject.findMany({ where: { enabled: true, ...(projectId ? { id: projectId } : {}) }, orderBy: { id: "asc" }, take: 2001, select: { id: true, userId: true, name: true, projectPath: true } });
    if (projects.length > 2000) return NextResponse.json({ error: "Schedule inventory limit exceeded" }, { status: 409 });
    const targets = [];
    for (let offset = 0; offset < projects.length; offset += 20) {
      targets.push(...await Promise.all(projects.slice(offset, offset + 20).map(async project => {
        const deployment = await prisma.rayDeployment.findFirst({ where: { userId: project.userId, projectId: project.id, status: "healthy" }, orderBy: { createdAt: "desc" }, select: { containerId: true } });
        return { userId: project.userId, projectId: project.id, projectName: project.name, projectPath: project.projectPath, containerId: deployment?.containerId || "" };
      })));
    }
    return NextResponse.json({ targets }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Target inventory unavailable" }, { status: 503 }); }
}

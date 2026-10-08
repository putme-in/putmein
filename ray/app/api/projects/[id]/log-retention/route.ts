import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { validLogSelections } from "@/lib/log-retention";
import { projectLogRetention } from "@/lib/project-log-retention";

export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get("ray_token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const project = await prisma.rayMonitorProject.findFirst({ where: { id, userId: user.userId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || !["preview", "clear"].includes(body.action) || (body.action === "clear" && !validLogSelections(body.items))) {
    return NextResponse.json({ error: "Preview the eligible logs before clearing them." }, { status: 400 });
  }
  try {
    const result = await projectLogRetention(user.userId, id, body.action === "clear" ? body.items : undefined);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not confirm log cleanup. Preview again before retrying." }, { status: 500 });
  }
}

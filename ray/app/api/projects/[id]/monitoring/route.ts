import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

async function handle(req: NextRequest, context: { params: Promise<{ id: string }> }, read: boolean) {
  const token = (await cookies()).get("ray_token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const project = await prisma.rayMonitorProject.findFirst({ where: { id, userId: user.userId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  try {
    const body = read ? { action: "get" } : await req.json();
    if (!body || !["get", "save", "preview"].includes(body.action)) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    if (JSON.stringify(body).length > 64000) return NextResponse.json({ error: "Monitoring settings are too large" }, { status: 400 });
    const response = await fetch(`${BRAIN_URL}/v1/monitor/config`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
      body: JSON.stringify({ action: body.action, userId: user.userId, projectId: id, config: body.config, sample: body.sample }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return NextResponse.json({ error: (await response.text()).slice(0, 1000) }, { status: response.status === 400 ? 400 : 502 });
    return NextResponse.json(await response.json(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Monitoring settings are unavailable. Restore the Brain connection and retry." }, { status: 502 });
  }
}
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) { return handle(req, context, true); }
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) { return handle(req, context, false); }

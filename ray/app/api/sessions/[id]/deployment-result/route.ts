import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash } from "crypto";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

// Only trusted database state becomes conversation context, never browser-supplied logs/secrets.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get("ray_token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.deploymentId !== "string" || body.deploymentId.length > 128) return NextResponse.json({ error: "Invalid deployment" }, { status: 400 });
  try {
    const [session, deployment] = await Promise.all([
      prisma.rayChatSession.findFirst({ where: { id, userId: user.userId }, select: { id: true } }),
      prisma.rayDeployment.findFirst({ where: { id: body.deploymentId, userId: user.userId }, select: { id: true, status: true } }),
    ]);
    if (!session || !deployment) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const statuses: Record<string, string> = { pending: "pending", building: "building", deploying: "deploying", healthy: "healthy", failed: "failed", stopped: "stopped" };
    const status = statuses[deployment.status] || "unknown";
    const content = `Deployment update: **${status}**. [View deployment](/deployments/${encodeURIComponent(deployment.id)}). This status comes from the deployment record; no credentials or application logs were added to chat.`;
    const messageId = "deployment-" + createHash("sha256").update(JSON.stringify([id, deployment.id])).digest("hex");
    const message = await prisma.rayChatMessage.upsert({
      where: { id: messageId }, update: { content }, create: { id: messageId, sessionId: id, role: "assistant", content },
    });
    return NextResponse.json({ message, status }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not sync deployment result" }, { status: 503 });
  }
}

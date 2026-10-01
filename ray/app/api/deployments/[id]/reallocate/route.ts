import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { findGuaranteedFreePort } from "@/lib/port-manager";

export const runtime = "nodejs";

// POST /api/deployments/[id]/reallocate — automatically reallocate a conflicted deployment port
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const deployment = await prisma.rayDeployment.findFirst({
      where: { id, userId: user.userId },
    });
    if (!deployment) {
      return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
    }

    const freePortResult = await findGuaranteedFreePort(null, user.userId);
    const newPort = freePortResult.port;

    const updatedDeployment = await prisma.rayDeployment.update({
      where: { id },
      data: {
        hostPort: newPort,
        deployUrl: `http://localhost:${newPort}`,
        buildLogs: (deployment.buildLogs || "") + `\n[Port Guard] Automatically resolved port conflict. Reallocated to :${newPort}`,
        updatedAt: new Date(),
      },
    });

    // Update any linked pipeline
    await prisma.rayPipeline.updateMany({
      where: { name: deployment.name, userId: user.userId },
      data: { port: newPort },
    }).catch(() => {});

    // Update any linked project
    await prisma.rayMonitorProject.updateMany({
      where: {
        userId: user.userId,
        OR: [
          { name: { equals: deployment.name } },
          { projectPath: { equals: deployment.projectPath } },
        ],
      },
      data: { projectUrl: `http://localhost:${newPort}` },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      port: newPort,
      deployment: updatedDeployment,
      message: `Successfully reallocated deployment to port :${newPort}`,
    });
  } catch (err: unknown) {
    console.error("POST /api/deployments/[id]/reallocate error:", err);
    return NextResponse.json(
      { error: "Failed to reallocate port", message: (err as Error).message },
      { status: 500 }
    );
  }
}

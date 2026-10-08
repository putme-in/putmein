import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { readProjectSetup } from "@/lib/project-setup-store";

export const maxDuration = 600;
const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";
type Context = { params: Promise<{ id: string }> };

async function handle(req: NextRequest, context: Context, read: boolean) {
  const token = (await cookies()).get("ray_token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const project = await prisma.rayMonitorProject.findFirst({
    where: { id, userId: user.userId },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const body = read ? { action: "releases" } : await req.json();
    if (!body || !["releases", "preview", "cleanup", "rollback", "recover"].includes(body.action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    const deployment = await prisma.rayDeployment.findFirst({
      where: { projectId: id, userId: user.userId, containerName: { not: null } },
      orderBy: { updatedAt: "desc" },
    });
    if (["rollback", "recover"].includes(body.action) && !deployment?.containerName) {
      return NextResponse.json({ error: "No managed runtime is linked to this project." }, { status: 409 });
    }
    if (body.action === "cleanup" && (
      !Array.isArray(body.paths) || body.paths.length > 100 ||
      body.paths.some((path: unknown) => typeof path !== "string" || path.length > 4096)
    )) {
      return NextResponse.json({ error: "Preview and select cleanup candidates first." }, { status: 400 });
    }

    const setup = await readProjectSetup(user.userId, id);
    const response = await fetch(`${BRAIN_URL}/v1/deploy/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "",
      },
      body: JSON.stringify({
        action: ["preview", "cleanup"].includes(body.action) ? "cleanup" : body.action,
        apply: body.action === "cleanup",
        paths: body.paths,
        userId: user.userId,
        projectId: id,
        projectPath: setup?.sourceRoot || project.projectPath,
        container: deployment?.containerName,
        deploymentId: deployment?.id,
      }),
      signal: AbortSignal.timeout(570000),
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: (await response.text()).slice(0, 1500) },
        { status: response.status === 409 ? 409 : 502 },
      );
    }
    const data = await response.json();
    // Runtime manifests include environment values; expose only this explicit list.
    if (data.releases) {
      data.releases = data.releases.map((release: { path: string; status: string; createdAt: string }) => ({
        path: release.path, status: release.status, createdAt: release.createdAt,
      }));
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({
      error: "Lifecycle operation could not complete. Check Brain and review deployment logs before retrying.",
    }, { status: 502 });
  }
}

export async function GET(req: NextRequest, context: Context) {
  return handle(req, context, true);
}
export async function POST(req: NextRequest, context: Context) {
  return handle(req, context, false);
}

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { defaultProjectSetup, parseProjectSetup } from "@/lib/project-setup";
import { readProjectSetup, saveProjectSetup, validateSetupSource, rebaseSetupToGitRoot } from "@/lib/project-setup-store";
import { parseDeploymentEnvironment } from "@/lib/deployment-runtime";
import { findDomainConflict } from "@/lib/domains";

type Context = { params: Promise<{ id: string }> };
async function contextData(context: Context) {
  const token = (await cookies()).get("ray_token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user?.userId) return null;
  const { id } = await context.params;
  const project = await prisma.rayMonitorProject.findFirst({ where: { id, userId: user.userId } });
  return project ? { user, project } : null;
}
export async function GET(_req: NextRequest, context: Context) {
  const data = await contextData(context);
  if (!data) return NextResponse.json({ error: "Project not found or unauthorized" }, { status: 404 });
  const { user, project } = data;
  const saved = await readProjectSetup(user.userId, project.id);
  if (saved) return NextResponse.json({ setup: saved }, { headers: { "Cache-Control": "no-store" } });
  const deployment = await prisma.rayDeployment.findFirst({ where: { userId: user.userId, projectId: project.id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ setup: await rebaseSetupToGitRoot({ ...defaultProjectSetup(), sourceRoot: deployment?.projectPath || project.projectPath,
    projectUrl: project.projectUrl?.split(/[,\n]/)[0]?.trim() || "", startCommand: project.runCommand || "",
    hostPort: deployment?.hostPort ?? null, containerPort: deployment?.containerPort ?? null,
    envVars: parseDeploymentEnvironment(deployment?.envVars) || {} }) }, { headers: { "Cache-Control": "no-store" } });
}
export async function PUT(req: NextRequest, context: Context) {
  const data = await contextData(context);
  if (!data) return NextResponse.json({ error: "Project not found or unauthorized" }, { status: 404 });
  const { user, project } = data;
  try {
    const previous = await readProjectSetup(user.userId, project.id);
    // Editing an application directory cannot substitute a different source root.
    const baseline = previous || await rebaseSetupToGitRoot({ ...defaultProjectSetup(), sourceRoot: project.projectPath });
    const setup = parseProjectSetup({ ...await req.json(), sourceRoot: baseline.sourceRoot });
    const validated = validateSetupSource(setup);
    if (!setup.dockerEnabled && !setup.startCommand.trim()) throw new Error("Enter a production start command for host deployment.");
    const others = await prisma.rayMonitorProject.findMany({ where: { userId: user.userId, id: { not: project.id } }, select: { id: true, name: true, projectUrl: true } });
    const conflict = findDomainConflict(setup.projectUrl, project.id, others);
    if (conflict.hasConflict) return NextResponse.json({ error: `Domain is already assigned to ${conflict.projectName}.` }, { status: 409 });
    await saveProjectSetup(user.userId, project.id, validated);
    if (setup.hostPort !== null) await prisma.rayPipeline.updateMany({ where: { userId: user.userId, projectId: project.id }, data: { port: setup.hostPort } });
    // These are desired settings. Active paths, containers and monitor commands stay
    // untouched until a successful deployment applies them.
    return NextResponse.json({ setup: validated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save setup." }, { status: 400 });
  }
}

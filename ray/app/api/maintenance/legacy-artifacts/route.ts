import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { readProjectSetup } from "@/lib/project-setup-store";

export const maxDuration = 330;
const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";
async function administrator() {
  const token = (await cookies()).get("ray_token")?.value;
  const user = token ? await verifyToken(token) : null;
  return user?.role?.toLowerCase() === "admin" ? user : null;
}
export async function GET() {
  return NextResponse.json({ available: Boolean(await administrator()) }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: NextRequest) {
  if (!await administrator()) return NextResponse.json({ error: "Administrator access is required for server-wide legacy review." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || !["preview", "quarantine", "restore", "delete-quarantine", "remove-docker"].includes(body.action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  if (body.action !== "preview" && (!Array.isArray(body.items) || !body.items.length || body.items.length > 20 ||
    body.items.some((item: { id?: unknown; fingerprint?: unknown }) => !item || typeof item.id !== "string" ||
      item.id.length > 4096 || typeof item.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(item.fingerprint)))) {
    return NextResponse.json({ error: "Select 1–20 items from a fresh review." }, { status: 400 });
  }
  try {
    // Include all owners: a folder shared by another project must not be removed.
    const [projects, deployments, pipelines] = await Promise.all([
      prisma.rayMonitorProject.findMany({ take: 2001, select: { id: true, userId: true, name: true, projectPath: true, logPaths: true, managedLogFile: true } }),
      prisma.rayDeployment.findMany({ take: 10001, orderBy: { updatedAt: "desc" }, select: { id: true, userId: true, projectId: true, name: true, projectPath: true, status: true, updatedAt: true, containerId: true, containerName: true, imageName: true } }),
      prisma.rayPipeline.findMany({ take: 2001, select: { id: true, userId: true, projectId: true, name: true } }),
    ]);
    if (projects.length > 2000 || deployments.length > 10000 || pipelines.length > 2000) {
      return NextResponse.json({ error: "This installation exceeds the bounded legacy inventory. Manual review is required; nothing was removed." }, { status: 409 });
    }
    const protectedPaths = new Set<string>();
    const protectedRuntimes = new Set<string>();
    const evidence: { path: string; owner: string; project: string; containerId: string }[] = [];
    const ownerProject = (owner: string, project: string | null, name: string) => project || projects.find(p => p.userId === owner && p.name === name)?.id || "";
    for (const project of projects) {
      if (project.projectPath) protectedPaths.add(project.projectPath);
      if (project.managedLogFile) protectedPaths.add(project.managedLogFile);
      const paths: unknown = JSON.parse(project.logPaths || "[]");
      if (!Array.isArray(paths) || paths.some(value => typeof value !== "string")) throw new Error("Invalid saved log paths");
      for (const path of paths) if (!path.startsWith("docker:")) protectedPaths.add(path);
      const setup = await readProjectSetup(project.userId, project.id);
      if (setup?.sourceRoot) protectedPaths.add(setup.sourceRoot);
    }
    const latest = new Set<string>();
    const cutoff = Date.now() - 30 * 86400000;
    for (const deployment of deployments) {
      const project = ownerProject(deployment.userId, deployment.projectId, deployment.name);
      const key = `${deployment.userId}:${project || deployment.name}`;
      const protect = !latest.has(key) || !["failed", "stopped"].includes(deployment.status) || deployment.updatedAt.getTime() >= cutoff;
      latest.add(key);
      if (protect) {
        if (deployment.projectPath) protectedPaths.add(deployment.projectPath);
        for (const value of [deployment.containerId, deployment.containerName, deployment.imageName]) if (value) protectedRuntimes.add(value);
      }
      evidence.push({ path: deployment.projectPath, owner: deployment.userId, project, containerId: deployment.containerId || "" });
    }
    const response = await fetch(`${BRAIN_URL}/v1/deploy/legacy`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
      body: JSON.stringify({
        action: body.action, items: body.items,
        protectedPaths: [...protectedPaths], protectedRuntimes: [...protectedRuntimes], evidence,
        projects: projects.map(project => ({ owner: project.userId, project: project.id })),
        pipelines: Object.fromEntries(pipelines.map(pipeline => [pipeline.id, {
          owner: pipeline.userId, project: ownerProject(pipeline.userId, pipeline.projectId, pipeline.name),
        }])),
      }),
      signal: AbortSignal.timeout(310000),
    });
    if (!response.ok) return NextResponse.json({ error: (await response.text()).slice(0, 1500) }, { status: response.status === 409 ? 409 : 502 });
    return NextResponse.json(await response.json(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Legacy review could not complete. Restore access to all project settings and Brain, then review again before retrying." }, { status: 502 });
  }
}

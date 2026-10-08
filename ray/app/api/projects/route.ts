import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { resolveProjectSource } from "@/lib/project-source";
import { parseProjectSetup } from "@/lib/project-setup";
import { saveProjectSetup, validateSetupSource, rebaseSetupToGitRoot } from "@/lib/project-setup-store";
import prisma from "@/lib/prisma";
import { detectProjectStack } from "@/lib/project-detector";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

// GET /api/projects — returns all tracked projects with container & status metadata
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const projects = await prisma.rayMonitorProject.findMany({
      where: { userId: user.userId },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: {
          select: { alerts: { where: { dismissed: false } } },
        },
      },
    });

    // Fetch active containers from Brain
    let containers: any[] = [];
    try {
      const cRes = await fetch(`${BRAIN_URL}/v1/containers`, { headers: { "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" }, signal: AbortSignal.timeout(3000) });
      if (cRes.ok) {
        const cData = await cRes.json();
        containers = cData.containers || [];
      }
    } catch { /* Brain offline */ }

    // Also fetch user's deployments to resolve registered containers & allocated ports
    const deployments = await prisma.rayDeployment.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "desc" },
    });

    // Auto-sync any deployments that don't have a RayMonitorProject record yet
    for (const d of deployments) {
      const exists = projects.some(
        (p) =>
          p.id === d.projectId ||
          p.name.toLowerCase() === d.name.toLowerCase() ||
          (d.projectPath && p.projectPath === d.projectPath)
      );
      if (!exists) {
        try {
          const newProj = await prisma.rayMonitorProject.create({
            data: {
              userId: user.userId,
              name: d.name,
              projectPath: d.projectPath || `/deployments/${d.name}`,
              logPaths: "[]",
              projectUrl: d.deployUrl || (d.hostPort ? `http://localhost:${d.hostPort}` : null),
              status: d.status === "healthy" ? "running" : d.status || "running",
              enabled: true,
              intervalSec: 30,
            },
          });
          // Update deployment link
          await prisma.rayDeployment.update({
            where: { id: d.id },
            data: { projectId: newProj.id },
          }).catch(() => { });
          projects.unshift({ ...newProj, _count: { alerts: 0 } } as any);
        } catch { /* concurrent */ }
      }
    }

    // Map projects with container metadata if running or registered in deployments
    const mappedProjects = projects.map((p) => {
      const baseName = p.name.toLowerCase();
      const matchedContainer = containers.find((c) => {
        const cName = (c.name || "").toLowerCase();
        return cName.includes("ray-" + baseName) || cName === baseName || cName.includes(baseName);
      });

      const matchedDep = deployments.find((d) => {
        const dName = (d.name || "").toLowerCase();
        return (
          d.projectId === p.id ||
          dName === baseName ||
          dName.includes(baseName) ||
          (d.containerName || "").toLowerCase().includes("ray-" + baseName)
        );
      });

      // Extract port from projectUrl if available
      let urlPort: number | null = null;
      if (p.projectUrl) {
        const portMatch = p.projectUrl.match(/:(\d+)/);
        if (portMatch) urlPort = parseInt(portMatch[1], 10);
      }

      const resolvedPort = matchedContainer?.port || urlPort || matchedDep?.hostPort || null;

      const hostMode = matchedDep?.containerName?.startsWith("process:") || false;
      const effectiveContainer = hostMode ? null : matchedContainer
        ? {
          ...matchedContainer,
          port: resolvedPort,
          url: matchedContainer.url || (resolvedPort ? `http://localhost:${resolvedPort}` : null),
        }
        : matchedDep
          ? {
            id: matchedDep.containerId || matchedDep.id,
            name: matchedDep.containerName || `ray-${baseName}`,
            status: matchedDep.status,
            port: resolvedPort,
            url: matchedDep.deployUrl || (resolvedPort ? `http://localhost:${resolvedPort}` : null),
          }
          : null;

      const stackInfo = detectProjectStack(p.projectPath, {
        projectName: p.name,
        runCommand: p.runCommand,
        memory: p.memory,
        containerImage: matchedContainer?.image || matchedDep?.imageName,
      });

      return {
        ...p,
        container: effectiveContainer,
        deployment: matchedDep
          ? {
            id: matchedDep.id,
            name: matchedDep.name,
            status: matchedDep.status,
            deployUrl: matchedDep.deployUrl,
            hostPort: matchedDep.hostPort,
            containerName: matchedDep.containerName,
            buildLogs: matchedDep.buildLogs,
            updatedAt: matchedDep.updatedAt,
          }
          : null,
        isDocker: !hostMode && (!!effectiveContainer || stackInfo.hasDockerfile || (p.memory || "").toLowerCase().includes("docker") || (p.logPaths || "").includes("docker")),
        runtime: hostMode ? "host" : "docker",
        framework: stackInfo.framework,
        frameworkSlug: stackInfo.frameworkSlug,
        language: stackInfo.language,
        icon: stackInfo.icon,
        colorClasses: stackInfo.colorClasses,
      };
    });

    return NextResponse.json({ projects: mappedProjects });
  } catch (err) {
    console.error("GET /api/projects:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/projects — manually add a project
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { name, projectUrl, runCommand } = body;
    let projectPath: string;
    try { projectPath = resolveProjectSource(body.projectPath).projectPath; } catch {
      return NextResponse.json({ error: "Choose an existing absolute project directory." }, { status: 400 });
    }

    if (typeof name !== "string" || !name.trim() || name.trim().length > 100 ||
        (runCommand != null && (typeof runCommand !== "string" || runCommand.includes("\0")))) {
      return NextResponse.json({ error: "Name and project path are required" }, { status: 400 });
    }

    if (projectUrl) {
      try {
        const url = new URL(projectUrl);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch {
        return NextResponse.json({ error: "Application URL must be HTTP or HTTPS without credentials." }, { status: 400 });
      }
    }

    let setup;
    try {
      setup = validateSetupSource(parseProjectSetup({ ...body.setup, sourceRoot: body.setup?.sourceRoot || projectPath,
        projectUrl: body.setup?.projectUrl ?? projectUrl ?? "", startCommand: body.setup?.startCommand ?? runCommand ?? "" }));
      projectPath = setup.projectPath;
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid setup" }, { status: 400 }); }
    const project = await prisma.rayMonitorProject.create({
      data: {
        userId: user.userId,
        name: name.trim(),
        projectPath: projectPath.trim(),
        projectUrl: setup.projectUrl || null,
        runCommand: setup.startCommand || null,
        logPaths: "[]",
        intervalSec: 30,
        enabled: true,
        status: "active",
      },
    });

    await saveProjectSetup(user.userId, project.id, await rebaseSetupToGitRoot(setup));

    // Auto-create CI/CD pipeline if this project is a Git repository
    const { ensureGitPipeline } = await import("@/lib/cicd-sync");
    await ensureGitPipeline(user.userId, project.name, project.projectPath, {
      projectId: project.id,
    }).catch(() => { });

    // Trigger async memory analysis via Brain
    try {
      fetch(`${BRAIN_URL}/v1/projects/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
        body: JSON.stringify({ path: project.projectPath, modelId: "MiniMax-M3" }),
      }).catch(() => { });
    } catch { /* silent */ }

    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    console.error("POST /api/projects:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

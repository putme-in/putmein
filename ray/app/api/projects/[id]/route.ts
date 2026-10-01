import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import os from "os";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { detectProjectStack } from "@/lib/project-detector";
import { findDomainConflict, getPrimaryProjectUrl } from "@/lib/domains";
import { detectServerIp } from "@/lib/network";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

// GET /api/projects/[id] — project details with connected container, CI/CD, GitHub, and server IP
export async function GET(
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

    const project = await prisma.rayMonitorProject.findFirst({
      where: { id, userId: user.userId },
      include: {
        _count: {
          select: { alerts: { where: { dismissed: false } } },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 1. Fetch active containers from Brain/Docker and registered deployments
    let container: any = null;
    try {
      const cRes = await fetch(`${BRAIN_URL}/v1/containers`, { headers: { "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" }, signal: AbortSignal.timeout(2500) });
      if (cRes.ok) {
        const cData = await cRes.json();
        const containers = cData.containers || [];
        const baseName = project.name.toLowerCase();
        container = containers.find((c: any) => {
          const cName = (c.name || "").toLowerCase();
          return cName.includes("ray-" + baseName) || cName === baseName || cName.includes(baseName);
        }) || null;
      }
    } catch { /* Brain offline */ }

    // Fetch registered deployment for this project
    const deployment = await prisma.rayDeployment.findFirst({
      where: {
        userId: user.userId,
        OR: [
          { projectId: project.id },
          { name: project.name },
          { name: project.name.toLowerCase() },
          { containerName: `ray-${project.name.toLowerCase()}` },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    // Extract port from projectUrl if available
    let urlPort: number | null = null;
    if (project.projectUrl) {
      const portMatch = project.projectUrl.match(/:(\d+)/);
      if (portMatch) urlPort = parseInt(portMatch[1], 10);
    }

    const resolvedPort = container?.port || urlPort || deployment?.hostPort || null;

    if (!container && deployment) {
      container = {
        id: deployment.containerId || deployment.id,
        name: deployment.containerName || `ray-${project.name.toLowerCase()}`,
        status: deployment.status === "healthy" ? "running" : deployment.status,
        port: resolvedPort,
        url: deployment.deployUrl || (resolvedPort ? `http://localhost:${resolvedPort}` : null),
        image: deployment.imageName,
      };
    } else if (container) {
      container.port = resolvedPort;
      if (!container.url && resolvedPort) {
        container.url = `http://localhost:${resolvedPort}`;
      }
    }

    // 2. Fetch linked CI/CD Pipeline
    const pipeline = await prisma.rayPipeline.findFirst({
      where: {
        userId: user.userId,
        OR: [
          { projectId: project.id },
          { name: project.name },
        ],
      },
      include: {
        runs: {
          orderBy: { createdAt: "desc" },
          take: 3,
        },
      },
    });

    // 3. Fetch GitHub integration status
    const githubIntegration = await prisma.rayGithubIntegration.findFirst({
      where: { userId: user.userId },
      select: { id: true, githubUsername: true, avatarUrl: true, createdAt: true },
    });

    // 4. Server IP detection for sslip.io and domain mapping
    const forceRefresh = req.nextUrl?.searchParams?.get("refresh") === "1";
    const { localIp, publicIp, isPrivateNetwork, isPubliclyExposed } = await detectServerIp(forceRefresh);

    const stackInfo = detectProjectStack(project.projectPath, {
      projectName: project.name,
      runCommand: project.runCommand,
      memory: project.memory,
      containerImage: container?.image || deployment?.imageName,
    });

    return NextResponse.json({
      project: {
        ...project,
        container,
        deployment: deployment || null,
        isDocker: !!container || stackInfo.hasDockerfile || (project.memory || "").toLowerCase().includes("docker") || (project.logPaths || "").includes("docker"),
        framework: stackInfo.framework,
        frameworkSlug: stackInfo.frameworkSlug,
        language: stackInfo.language,
        icon: stackInfo.icon,
        colorClasses: stackInfo.colorClasses,
      },
      deployment: deployment || null,
      pipeline: pipeline || null,
      github: {
        connected: !!githubIntegration,
        integration: githubIntegration || null,
      },
      network: {
        localIp,
        publicIp,
        isPrivateNetwork,
        isPubliclyExposed,
      },
    });
  } catch (err) {
    console.error("GET /api/projects/[id]:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH /api/projects/[id] — update project name, projectUrl / domain, etc.
export async function PATCH(
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
    const body = await req.json();
    const { name, projectUrl, enabled, intervalSec } = body;

    const existing = await prisma.rayMonitorProject.findFirst({
      where: { id, userId: user.userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined && typeof name === "string" && name.trim()) {
      updateData.name = name.trim();
    }
    if (projectUrl !== undefined) {
      const cleanUrl = projectUrl ? projectUrl.trim() : null;
      if (cleanUrl) {
        const otherProjects = await prisma.rayMonitorProject.findMany({
          where: {
            userId: user.userId,
            id: { not: id },
          },
          select: { id: true, name: true, projectUrl: true },
        });

        const conflict = findDomainConflict(cleanUrl, id, otherProjects);
        if (conflict.hasConflict) {
          return NextResponse.json(
            { error: `Domain "${conflict.domain}" is already assigned to project "${conflict.projectName}".` },
            { status: 409 }
          );
        }
      }
      updateData.projectUrl = cleanUrl;
    }
    if (enabled !== undefined) {
      updateData.enabled = !!enabled;
      updateData.status = enabled ? "active" : "paused";
    }
    if (intervalSec !== undefined) {
      updateData.intervalSec = Number(intervalSec) || 30;
    }

    const updated = await prisma.rayMonitorProject.update({
      where: { id },
      data: updateData,
    });

    if (updateData.projectUrl !== undefined) {
      const primaryUrl = getPrimaryProjectUrl(updateData.projectUrl as string);
      await prisma.rayDeployment.updateMany({
        where: {
          userId: user.userId,
          OR: [
            { projectId: id },
            { name: existing.name },
            { name: existing.name.toLowerCase() },
          ],
        },
        data: {
          deployUrl: primaryUrl,
        },
      }).catch(() => {});
    }

    // Notify Brain if running
    try {
      await fetch(`${BRAIN_URL}/v1/monitor/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
        signal: AbortSignal.timeout(3000),
      });
    } catch { /* Brain offline */ }

    return NextResponse.json({ project: updated });
  } catch (err) {
    console.error("PATCH /api/projects/[id]:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// DELETE /api/projects/[id] — complete deletion of project, docker containers, files, logs, and database records
export async function DELETE(
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

    const project = await prisma.rayMonitorProject.findFirst({
      where: { id, userId: user.userId },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 1. Collect all linked deployments and container names
    const deployments = await prisma.rayDeployment.findMany({
      where: {
        userId: user.userId,
        OR: [
          { projectId: project.id },
          { name: project.name },
          { name: project.name.toLowerCase() },
          { containerName: `ray-${project.name.toLowerCase()}` },
        ],
      },
    });

    const containerNamesToKill = new Set<string>();
    const imageNamesToKill = new Set<string>();

    // Standard naming convention
    const cleanBaseName = project.name.toLowerCase().replace(/[^a-z0-9-_]/g, "");
    if (cleanBaseName) {
      containerNamesToKill.add(`ray-${cleanBaseName}`);
      containerNamesToKill.add(cleanBaseName);
      imageNamesToKill.add(`ray-${cleanBaseName}:latest`);
      imageNamesToKill.add(`ray-${cleanBaseName}`);
    }

    for (const dep of deployments) {
      if (dep.containerName) containerNamesToKill.add(dep.containerName);
      if (dep.containerId) containerNamesToKill.add(dep.containerId);
      if (dep.imageName) imageNamesToKill.add(dep.imageName);
    }

    // 2. Kill and remove Docker containers, compose stacks, volumes, and networks
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    const fs = await import("fs");
    const path = await import("path");

    // 2a. Run docker compose down if compose file exists in project directory
    if (project.projectPath && fs.existsSync(project.projectPath)) {
      try {
        const hasCompose =
          fs.existsSync(path.join(project.projectPath, "docker-compose.yml")) ||
          fs.existsSync(path.join(project.projectPath, "docker-compose.yaml")) ||
          fs.existsSync(path.join(project.projectPath, "compose.yml")) ||
          fs.existsSync(path.join(project.projectPath, "compose.yaml"));

        if (hasCompose) {
          try {
            await execAsync(`docker compose down -v --remove-orphans`, { cwd: project.projectPath });
          } catch {
            try {
              await execAsync(`docker-compose down -v --remove-orphans`, { cwd: project.projectPath });
            } catch { /* ignore compose errors */ }
          }
        }
      } catch { /* ignore compose errors */ }
    }

    // 2b. Discover any active or stopped containers associated with this project name
    try {
      const { stdout: psOut } = await execAsync(
        `docker ps -a --format "{{.ID}}\t{{.Names}}\t{{.Image}}"`
      );
      if (psOut) {
        for (const line of psOut.split("\n")) {
          const [cId, cNames, cImage] = line.split("\t");
          if (!cId) continue;
          const lowerNames = (cNames || "").toLowerCase();
          const lowerImage = (cImage || "").toLowerCase();

          if (
            (cleanBaseName && (
              lowerNames.includes(cleanBaseName) ||
              lowerNames.startsWith(`${cleanBaseName}-`) ||
              lowerNames.startsWith(`${cleanBaseName}_`) ||
              lowerNames.startsWith(`ray-${cleanBaseName}`) ||
              lowerImage.includes(`ray-${cleanBaseName}`)
            ))
          ) {
            containerNamesToKill.add(cId);
            if (cNames) containerNamesToKill.add(cNames);
          }
        }
      }
    } catch { /* Docker daemon not available */ }

    // 2c. Force remove all discovered containers
    for (const cName of containerNamesToKill) {
      try {
        await execAsync(`docker rm -f ${cName}`);
      } catch { /* ignore */ }
      // Also notify Brain container action endpoint
      try {
        await fetch(`${BRAIN_URL}/v1/containers/${encodeURIComponent(cName)}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
          body: JSON.stringify({ action: "remove" }),
          signal: AbortSignal.timeout(2000),
        });
      } catch { /* ignore */ }
    }

    // 2d. Force remove associated Docker images, volumes, and networks
    for (const img of imageNamesToKill) {
      try {
        await execAsync(`docker rmi -f ${img}`);
      } catch { /* ignore */ }
    }

    if (cleanBaseName) {
      try {
        const { stdout: volOut } = await execAsync(
          `docker volume ls -q --filter name=${cleanBaseName}`
        );
        for (const vol of volOut.split("\n").map((v) => v.trim()).filter(Boolean)) {
          try {
            await execAsync(`docker volume rm -f ${vol}`);
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }

      try {
        const { stdout: netOut } = await execAsync(
          `docker network ls -q --filter name=${cleanBaseName}`
        );
        for (const net of netOut.split("\n").map((n) => n.trim()).filter(Boolean)) {
          try {
            await execAsync(`docker network rm ${net}`);
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }

    // 3. Stop managed PID if running
    if (project.managedPid) {
      try {
        process.kill(project.managedPid, "SIGTERM");
      } catch { /* process already dead */ }
    }

    // 4. Safely delete physical project folder files on disk
    const isSafeToDelete = (targetPath: string): boolean => {
      if (!targetPath || typeof targetPath !== "string") return false;
      try {
        const resolved = path.resolve(targetPath);
        const root = path.parse(resolved).root;
        if (resolved === root) return false;

        const forbiddenExact = [
          "/",
          "/Users",
          "/home",
          "/etc",
          "/var",
          "/tmp",
          "/usr",
          "/bin",
          "/sbin",
          "/Applications",
          "/System",
          "/Library",
          os.homedir(),
          process.cwd(),
        ];
        if (forbiddenExact.includes(resolved)) return false;
        if (resolved === os.homedir()) return false;

        // Ensure path exists before attempting deletion
        return fs.existsSync(resolved);
      } catch {
        return false;
      }
    };

    if (isSafeToDelete(project.projectPath)) {
      try {
        fs.rmSync(project.projectPath, { recursive: true, force: true });
      } catch (err) {
        console.error("Failed to delete project directory:", err);
      }
    }

    if (project.managedLogFile && fs.existsSync(project.managedLogFile)) {
      try {
        fs.rmSync(project.managedLogFile, { force: true });
      } catch { /* ignore */ }
    }

    // 5. Notify Brain monitor loop to stop monitoring
    try {
      await fetch(`${BRAIN_URL}/v1/monitor/projects/${id}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(3000),
      });
    } catch { /* Brain offline */ }

    // 6. Cascade delete database records
    // Alerts
    await prisma.rayMonitorAlert.deleteMany({
      where: { projectId: project.id },
    });

    // Pipelines & Pipeline Runs
    const pipelines = await prisma.rayPipeline.findMany({
      where: {
        userId: user.userId,
        OR: [{ projectId: project.id }, { name: project.name }],
      },
      select: { id: true },
    });
    const pipelineIds = pipelines.map((p) => p.id);
    if (pipelineIds.length > 0) {
      await prisma.rayPipelineRun.deleteMany({
        where: { pipelineId: { in: pipelineIds } },
      });
      await prisma.rayPipeline.deleteMany({
        where: { id: { in: pipelineIds } },
      });
    }

    // Deployments
    await prisma.rayDeployment.deleteMany({
      where: {
        userId: user.userId,
        OR: [
          { projectId: project.id },
          { name: project.name },
          { name: project.name.toLowerCase() },
          { containerName: `ray-${project.name.toLowerCase()}` },
        ],
      },
    });

    // RayMonitorProject
    await prisma.rayMonitorProject.delete({
      where: { id: project.id },
    });

    return NextResponse.json({
      ok: true,
      message: `Project ${project.name} and all linked resources deleted successfully.`,
    });
  } catch (err) {
    console.error("DELETE /api/projects/[id]:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

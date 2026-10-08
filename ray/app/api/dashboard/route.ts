import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import os from "os";
import fs from "fs";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { detectContainerStack, detectProjectStack, getFrameworkVisuals } from "@/lib/project-detector";
import { getPrimaryProjectUrl } from "@/lib/domains";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // 1. Live System / Server Stats
    let diskPercent = 0;
    let diskTotalBytes = 0;
    let diskUsedBytes = 0;
    try {
      const stat = fs.statfsSync("/");
      const blockSize = stat.bsize;
      diskTotalBytes = stat.blocks * blockSize;
      const freeBytes = stat.bfree * blockSize;
      diskUsedBytes = diskTotalBytes - freeBytes;
      diskPercent = diskTotalBytes > 0 ? Math.round((diskUsedBytes / diskTotalBytes) * 100) : 0;
    } catch (e) {
      console.error("Failed to read disk stats:", e);
    }

    const cpus = os.cpus();
    const cpuCount = cpus.length || 1;
    const cpuPercent = Math.min(100, Math.round((os.loadavg()[0] / cpuCount) * 100));
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = Math.round((usedMem / totalMem) * 100);

    const uptimeSeconds = os.uptime();
    const days = Math.floor(uptimeSeconds / (3600 * 24));
    const hours = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const uptimeStr = `${days}d ${hours}h ${minutes}m`;
    const loadAvg = os.loadavg().map((v) => Number(v.toFixed(2)));

    const serverStats = {
      name: "localhost",
      ip: "127.0.0.1",
      status: "online" as const,
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      cpuModel: cpus[0]?.model || "Standard CPU",
      cpusCount: cpuCount,
      cpu: cpuPercent,
      memory: memPercent,
      disk: diskPercent,
      uptime: uptimeStr,
      uptimeSeconds,
      loadAvg,
      memoryFormatted: `${formatBytes(usedMem)} / ${formatBytes(totalMem)}`,
      diskFormatted: `${formatBytes(diskUsedBytes)} / ${formatBytes(diskTotalBytes)}`,
    };

    // 2. Fetch Projects, Deployments, Alerts from Prisma (in parallel)
    const [dbProjects, dbDeployments, dbAlerts, undismissedAlertsCount, severityCounts] = await Promise.all([
      prisma.rayMonitorProject.findMany({
        where: { userId: user.userId },
        orderBy: { updatedAt: "desc" },
        include: {
          _count: { select: { alerts: { where: { dismissed: false } } } },
        },
      }),
      prisma.rayDeployment.findMany({
        where: { userId: user.userId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.rayMonitorAlert.findMany({
        where: {
          project: { userId: user.userId },
        },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          project: { select: { id: true, name: true } },
        },
      }),
      prisma.rayMonitorAlert.count({
        where: {
          project: { userId: user.userId },
          dismissed: false,
        },
      }),
      prisma.rayMonitorAlert.groupBy({ by: ["severity"], where: { project: { userId: user.userId }, dismissed: false }, _count: { _all: true } }),
    ]);

    // 3. Query Containers from Brain (with timeout & fallback)
    let rawContainers: any[] = [];
    try {
      const cRes = await fetch(`${BRAIN_URL}/v1/containers`, {
        headers: { "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
        signal: AbortSignal.timeout(3500),
      });
      if (cRes.ok) {
        const cData = await cRes.json();
        rawContainers = cData.containers || [];
      }
    } catch {
      // Brain or Docker unavailable
    }

    // Enrich containers with stack detection and project/deployment links
    const enrichedContainers = rawContainers.map((c) => {
      const cName = (c.name || "").toLowerCase();
      const matchedDep = dbDeployments.find((d) => {
        const dName = (d.name || "").toLowerCase();
        const dContName = (d.containerName || "").toLowerCase();
        return (
          d.id === c.id ||
          d.containerId === c.id ||
          dContName === cName ||
          dName === cName ||
          cName.includes(dName) ||
          cName.includes("ray-" + dName)
        );
      });

      const matchedProj = dbProjects.find((p) => {
        const pName = p.name.toLowerCase();
        return (
          matchedDep?.projectId === p.id ||
          pName === cName ||
          cName.includes(pName) ||
          cName.includes("ray-" + pName)
        );
      });

      const stack = detectContainerStack(
        { name: c.name, image: c.image },
        matchedProj
          ? { projectPath: matchedProj.projectPath, memory: matchedProj.memory, runCommand: matchedProj.runCommand }
          : undefined
      );

      const port = c.port || matchedDep?.hostPort;
      const url =
        getPrimaryProjectUrl(matchedProj?.projectUrl || matchedDep?.deployUrl, port) ||
        c.url ||
        (port ? `http://localhost:${port}` : null);

      return {
        id: c.id,
        name: c.name,
        image: c.image,
        status: c.status,
        state: (c.state || "exited") as "running" | "exited" | "paused" | "restarting",
        ports: c.ports || (port ? `${port}->${c.containerPort || 3000}/tcp` : ""),
        port,
        url,
        createdAt: c.createdAt || c.created,
        cpu: c.cpu,
        memory: c.memory,
        isRay: Boolean(c.isRay || c.name?.startsWith("ray-") || matchedDep || matchedProj),
        framework: stack.framework,
        frameworkSlug: stack.frameworkSlug,
        language: stack.language,
        icon: stack.icon,
        colorClasses: stack.colorClasses,
        projectId: matchedProj?.id || null,
        projectName: matchedProj?.name || null,
        deploymentId: matchedDep?.id || null,
      };
    });

    // 4. Enrich Deployments
    const enrichedDeployments = dbDeployments.map((d) => {
      let framework = "Custom";
      let frameworkSlug = "custom";
      let language = "JavaScript";
      let icon = "logos:docker-icon";
      let colorClasses = "bg-white/[0.08] border-white/20 text-white";

      try {
        if (d.projectPath && fs.existsSync(d.projectPath)) {
          const detected = detectProjectStack(d.projectPath);
          framework = detected.framework;
          frameworkSlug = detected.frameworkSlug;
          language = detected.language;
          icon = detected.icon;
          colorClasses = detected.colorClasses;
        } else if (d.imageName) {
          const detected = detectContainerStack({ name: d.name, image: d.imageName });
          framework = detected.framework;
          frameworkSlug = detected.frameworkSlug;
          language = detected.language;
          icon = detected.icon;
          colorClasses = detected.colorClasses;
        } else {
          const visuals = getFrameworkVisuals(d.name);
          icon = visuals.icon;
          colorClasses = visuals.colorClasses;
        }
      } catch {
        // use defaults
      }

      return {
        id: d.id,
        name: d.name,
        sourceType: d.sourceType,
        repoUrl: d.repoUrl,
        branch: d.branch || "main",
        commitHash: d.commitHash,
        commitMessage: d.commitMessage,
        projectPath: d.projectPath,
        containerName: d.containerName,
        hostPort: d.hostPort,
        status: d.status as "pending" | "building" | "deploying" | "healthy" | "failed" | "stopped",
        deployUrl: d.deployUrl || (d.hostPort ? `http://localhost:${d.hostPort}` : null),
        createdAt: d.createdAt.toISOString(),
        framework,
        frameworkSlug,
        language,
        icon,
        colorClasses,
      };
    });

    // 5. KPIs & Summaries
    const runningContainersCount = enrichedContainers.filter((c) => c.state === "running").length;
    const totalContainersCount = enrichedContainers.length;

    const healthyDeploymentsCount = enrichedDeployments.filter((d) => d.status === "healthy").length;
    const buildingDeploymentsCount = enrichedDeployments.filter(
      (d) => d.status === "building" || d.status === "deploying" || d.status === "pending"
    ).length;
    const failedDeploymentsCount = enrichedDeployments.filter((d) => d.status === "failed").length;

    const criticalAlertsCount = severityCounts.filter(a => a.severity === "critical").reduce((sum, a) => sum + a._count._all, 0);
    const warnAlertsCount = severityCounts.filter(a => a.severity === "warn" || a.severity === "error").reduce((sum, a) => sum + a._count._all, 0);

    return NextResponse.json({
      server: serverStats,
      containers: {
        total: totalContainersCount,
        running: runningContainersCount,
        stopped: totalContainersCount - runningContainersCount,
        items: enrichedContainers.slice(0, 10),
      },
      deployments: {
        total: enrichedDeployments.length,
        healthy: healthyDeploymentsCount,
        building: buildingDeploymentsCount,
        failed: failedDeploymentsCount,
        recent: enrichedDeployments.slice(0, 6),
      },
      monitor: {
        totalProjects: dbProjects.length,
        activeProjects: dbProjects.filter((p) => p.status === "active").length,
        undismissedAlertsCount,
        criticalAlertsCount,
        warnAlertsCount,
        recentAlerts: dbAlerts.map((a) => ({
          id: a.id,
          severity: a.severity,
          message: a.message,
          rawLog: a.rawLog?.slice(0, 300) || "",
          dismissed: a.dismissed,
          createdAt: a.createdAt.toISOString(),
          projectName: a.project?.name || "Unknown Project",
          projectId: a.projectId,
        })),
        projects: dbProjects.slice(0, 4).map((p) => ({
          id: p.id,
          name: p.name,
          projectPath: p.projectPath,
          projectUrl: p.projectUrl,
          status: p.status,
          alertsCount: p._count.alerts,
          lastChecked: p.lastChecked?.toISOString() || null,
        })),
      },
      user: {
        id: user.userId,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Failed to load dashboard metrics" }, { status: 500 });
  }
}

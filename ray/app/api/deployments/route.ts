import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { detectProjectStack, detectContainerStack } from "@/lib/project-detector";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

// GET /api/deployments — list all deployments with auto-sync
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let [deployments, projects] = await Promise.all([
      prisma.rayDeployment.findMany({
        where: { userId: user.userId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.rayMonitorProject.findMany({
        where: { userId: user.userId },
      }),
    ]);

    // Check containers from Brain
    let containers: any[] = [];
    try {
      const cRes = await fetch(`${BRAIN_URL}/v1/containers`, { headers: { "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" }, signal: AbortSignal.timeout(3000) });
      if (cRes.ok) {
        const cData = await cRes.json();
        containers = cData.containers || [];
      }
    } catch { /* silent */ }

    // Auto-discover active ray-* containers created via chat/CLI and register if missing
    for (const c of containers) {
      if (c.name && c.name.startsWith("ray-")) {
        const cleanName = c.name.replace(/^ray-/, "");
        const alreadyExists = deployments.some(
          (d) => d.name.toLowerCase() === cleanName.toLowerCase() || d.containerName === c.name
        );
        if (!alreadyExists) {
          try {
            const newDep = await prisma.rayDeployment.create({
              data: {
                userId: user.userId,
                name: cleanName,
                sourceType: "container",
                projectPath: `/deployments/${cleanName}`,
                containerName: c.name,
                imageName: c.image || `${c.name}:latest`,
                status: c.state === "running" ? "healthy" : (c.state === "restarting" ? "building" : "stopped"),
                hostPort: c.port || null,
                deployUrl: c.url || (c.port ? `http://localhost:${c.port}` : ""),
                buildLogs: `Docker container ${c.name} running from image ${c.image || "custom"}.`,
              },
            });
            deployments.unshift(newDep);
          } catch { /* silent */ }
        }
      }
    }

    // Update deployments without prematurely resolving building states
    const updatedDeployments = await Promise.all(
      deployments.map(async (dep) => {
        const hostMode = dep.containerName?.startsWith("process:") || false;
        const baseName = dep.name.toLowerCase();
        const matched = hostMode ? undefined : containers.find((c) => {
          const cName = (c.name || "").toLowerCase();
          return cName.includes("ray-" + baseName) || cName === baseName || cName.includes(baseName);
        });

        let activeDep = dep;
        if (dep.status === "building" || dep.status === "pending") {
          // If building was started recently, preserve building status.
          // Never prematurely mark as healthy just because an older container exists!
          const ageMs = Date.now() - new Date(dep.updatedAt || dep.createdAt).getTime();
          if (ageMs > (hostMode ? 15 : 3) * 60 * 1000) {
            activeDep = await prisma.rayDeployment.update({
              where: { id: dep.id },
              data: {
                status: "failed",
                buildLogs: (dep.buildLogs || "") + `\n[Ray] Build process stopped responding after ${hostMode ? 15 : 3} minutes. Check the deployment runtime and build logs.`,
              },
            });
          }
        } else if (dep.sourceType === "static" && dep.status === "pending") {
          const ageMs = Date.now() - new Date(dep.createdAt).getTime();
          if (ageMs > 5000) {
            activeDep = await prisma.rayDeployment.update({
              where: { id: dep.id },
              data: {
                status: "healthy",
                buildLogs: dep.buildLogs || "Deploy finished. Static application packaged and ready.",
              },
            });
          }
        } else if (dep.status === "healthy" && matched && (matched.state === "exited" || matched.state === "dead")) {
          activeDep = await prisma.rayDeployment.update({
            where: { id: dep.id },
            data: {
              status: "stopped",
            },
          });
        }

        // Detect framework and runtime stack
        const linkedProject = projects.find(
          (p) =>
            p.name.toLowerCase() === baseName ||
            (dep.projectPath && p.projectPath && dep.projectPath.includes(p.projectPath)) ||
            (p.projectPath && p.projectPath.toLowerCase().includes(baseName))
        );

        let stack = detectContainerStack(
          {
            name: matched?.name || dep.containerName || `ray-${dep.name}`,
            image: matched?.image || dep.imageName || undefined,
          },
          linkedProject ? { projectPath: linkedProject.projectPath, memory: linkedProject.memory } : undefined
        );

        // Fallback: If container stack was generic Docker, try project path inspection directly
        if (stack.frameworkSlug === "docker" && dep.projectPath) {
          const fromPath = detectProjectStack(dep.projectPath);
          if (fromPath.frameworkSlug !== "node" || fromPath.hasDockerfile) {
            stack = fromPath;
          }
        }

        return {
          ...activeDep,
          framework: stack.framework,
          frameworkSlug: stack.frameworkSlug,
          language: stack.language,
          icon: stack.icon,
          colorClasses: stack.colorClasses,
          isDocker: !hostMode && (stack.hasDockerfile || dep.sourceType === "container" || !!matched || !!dep.containerName),
          runtime: hostMode ? "host" : "docker",
          container: matched
            ? {
                id: matched.id,
                name: matched.name,
                state: matched.state,
                port: matched.port || activeDep.hostPort,
                image: matched.image,
                url: matched.url || activeDep.deployUrl,
              }
            : null,
        };
      })
    );

    return NextResponse.json({ deployments: updatedDeployments });
  } catch (err) {
    console.error("GET /api/deployments:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

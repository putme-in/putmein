import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { detectProjectStack, detectContainerStack } from "@/lib/project-detector";
import { ensureGitPipeline, detectGitRemoteUrl } from "@/lib/cicd-sync";
import { validateGithubRepoUrl } from "@/lib/github-url";
import { isValidGitBranch } from "@/lib/github-webhook";
import { validateTcpPort } from "@/lib/port-validator";

// Helper to strip internal access tokens from repo URLs for clean presentation
function sanitizeRepoUrl(url: string | null | undefined): string {
  if (!url) return "";
  return url.replace(/https?:\/\/[^@]+@github\.com\//i, "https://github.com/");
}

// GET /api/cicd — list pipelines for locally added git projects only
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // 1. Fetch active local projects from monitor for this user
    const monitorProjects = await prisma.rayMonitorProject.findMany({
      where: { userId: user.userId },
      select: { id: true, name: true, projectPath: true, memory: true },
    });

    const activeProjectNames = new Set<string>();
    const activeProjectIds = new Set<string>();
    const projectMap = new Map<string, typeof monitorProjects[0]>();

    for (const p of monitorProjects) {
      activeProjectNames.add(p.name.toLowerCase());
      activeProjectIds.add(p.id);
      projectMap.set(p.id, p);
      projectMap.set(p.name.toLowerCase(), p);
      if (p.projectPath) {
        ensureGitPipeline(user.userId, p.name, p.projectPath, { projectId: p.id }).catch(() => {});
      }
    }

    // 2. Fetch all pipelines for the user with recent runs
    const allPipelines = await prisma.rayPipeline.findMany({
      where: { userId: user.userId },
      orderBy: { updatedAt: "desc" },
      include: {
        runs: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    // Clean up any pipelines for projects that are NOT on the local machine
    const orphanedPipelineIds: string[] = [];
    const seenNames = new Set<string>();
    const pipelines: any[] = [];

    for (const p of allPipelines) {
      const lowerName = p.name.toLowerCase();
      const isLocal = activeProjectNames.has(lowerName) || (p.projectId && activeProjectIds.has(p.projectId));
      if (!isLocal) {
        orphanedPipelineIds.push(p.id);
        continue;
      }

      if (!seenNames.has(lowerName)) {
        seenNames.add(lowerName);

        const linkedProj = (p.projectId && projectMap.get(p.projectId)) || projectMap.get(lowerName);
        let stack = detectContainerStack(
          { name: p.name },
          linkedProj ? { projectPath: linkedProj.projectPath, memory: linkedProj.memory } : undefined
        );

        if (stack.frameworkSlug === "docker" && linkedProj?.projectPath) {
          const fromPath = detectProjectStack(linkedProj.projectPath);
          if (fromPath.frameworkSlug !== "node" || fromPath.hasDockerfile) {
            stack = fromPath;
          }
        }

        pipelines.push({
          ...p,
          framework: stack.framework,
          frameworkSlug: stack.frameworkSlug,
          language: stack.language,
          icon: stack.icon,
          colorClasses: stack.colorClasses,
          isDocker: stack.hasDockerfile || !!p.dockerfilePath,
          repoUrl: sanitizeRepoUrl(p.repoUrl),
        });
      }
    }

    // Delete orphaned non-local pipelines from database
    if (orphanedPipelineIds.length > 0) {
      prisma.rayPipeline.deleteMany({
        where: { id: { in: orphanedPipelineIds } },
      }).catch(() => {});
    }

    // Calculate aggregate metrics
    const totalRuns = pipelines.reduce((sum, p) => sum + (p.runs?.length || 0), 0);
    const successfulRuns = pipelines.reduce(
      (sum, p) => sum + (p.runs?.filter((r: any) => r.status === "success").length || 0),
      0
    );
    const successRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 100;
    const automatedCount = pipelines.filter((p) => p.autoDeploy).length;

    return NextResponse.json({
      pipelines,
      stats: {
        totalPipelines: pipelines.length,
        automatedCount,
        totalRuns,
        successRate,
      },
    });
  } catch (err) {
    console.error("GET /api/cicd:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/cicd — create a pipeline
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { name, repoUrl, branch = "main", autoDeploy = true, port = 3000, dockerfilePath = "Dockerfile" } = body;

    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName) {
      return NextResponse.json({ error: "Pipeline name is required" }, { status: 400 });
    }

    const repoValidation = validateGithubRepoUrl(repoUrl);
    if (!repoValidation.valid) {
      return NextResponse.json({ error: repoValidation.error || "Invalid GitHub repository URL" }, { status: 400 });
    }

    const trimmedBranch = typeof branch === "string" ? branch.trim() : "main";
    if (trimmedBranch && !isValidGitBranch(trimmedBranch)) {
      return NextResponse.json({ error: "Invalid target Git branch name" }, { status: 400 });
    }

    if (port !== undefined && port !== null && port !== "") {
      const portValidation = validateTcpPort(port);
      if (!portValidation.valid) {
        return NextResponse.json({ error: portValidation.error }, { status: 400 });
      }
    }

    let allocatedPort = Number(port);
    if (!allocatedPort || allocatedPort === 4567 || allocatedPort === 4500) {
      const { findGuaranteedFreePort } = await import("@/lib/port-manager");
      const freePortResult = await findGuaranteedFreePort(null, user.userId);
      allocatedPort = freePortResult.port;
    }

    const pipeline = await prisma.rayPipeline.create({
      data: {
        userId: user.userId,
        name: trimmedName,
        repoUrl: repoValidation.normalizedUrl || String(repoUrl).trim(),
        branch: trimmedBranch || "main",
        autoDeploy: !!autoDeploy,
        port: allocatedPort,
        dockerfilePath: typeof dockerfilePath === "string" ? dockerfilePath.trim() || "Dockerfile" : "Dockerfile",
        status: "idle",
      },
    });

    return NextResponse.json({ pipeline }, { status: 201 });
  } catch (err) {
    console.error("POST /api/cicd:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

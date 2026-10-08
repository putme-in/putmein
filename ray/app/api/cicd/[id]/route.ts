import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { readProjectSetup, saveProjectSetup, validateSetupSource } from "@/lib/project-setup-store";
import prisma from "@/lib/prisma";
import { supportsGitHubPush, redactGitUrl } from "@/lib/git-url";
import { detectProjectStack, detectContainerStack } from "@/lib/project-detector";
import { validateTcpPort } from "@/lib/port-validator";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

// Helper to locate pipeline with admin override and single-user local fallback
async function findAuthorizedPipeline(
  id: string,
  user: { userId: string; role?: string },
  includeRuns = false
) {
  const isAdmin = user.role === "ADMIN" || user.role === "admin";
  const includeClause = includeRuns
    ? {
        runs: {
          orderBy: { createdAt: "desc" as const },
        },
      }
    : undefined;

  let pipeline = await prisma.rayPipeline.findFirst({
    where: isAdmin ? { id } : { id, userId: user.userId },
    ...(includeClause && { include: includeClause }),
  });

  if (!pipeline) {
    const existing = await prisma.rayPipeline.findUnique({
      where: { id },
      ...(includeClause && { include: includeClause }),
    });

    if (existing) {
      const userCount = await prisma.user.count();
      if (isAdmin || userCount <= 1 || existing.userId === user.userId) {
        pipeline = existing;
      } else {
        return { pipeline: null, forbidden: true };
      }
    }
  }

  return { pipeline, forbidden: false };
}

// GET /api/cicd/[id] — get pipeline with all runs & stack metadata
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

    const resolvedParams = await params;
    const rawId = resolvedParams?.id;
    const id = rawId ? decodeURIComponent(rawId).trim() : "";
    if (!id) return NextResponse.json({ error: "Pipeline ID is required" }, { status: 400 });

    const { pipeline, forbidden } = await findAuthorizedPipeline(id, user, true);
    if (forbidden) {
      return NextResponse.json({ error: "Forbidden: You do not have permission to view this pipeline" }, { status: 403 });
    }
    if (!pipeline) {
      return NextResponse.json({ error: `Pipeline not found: ${id}` }, { status: 404 });
    }

    const linkedProj = pipeline.projectId
      ? await prisma.rayMonitorProject.findFirst({ where: { id: pipeline.projectId, userId: user.userId } })
      : await prisma.rayMonitorProject.findFirst({ where: { name: { equals: pipeline.name }, userId: user.userId } });

    const linkedDep = await prisma.rayDeployment.findFirst({
      where: {
        userId: user.userId,
        OR: [
          { name: { equals: pipeline.name } },
          { id: pipeline.projectId || "" },
        ],
      },
    });

    let stack = detectContainerStack(
      { name: pipeline.name },
      linkedProj ? { projectPath: linkedProj.projectPath, memory: linkedProj.memory } : undefined
    );

    if (stack.frameworkSlug === "docker" && linkedProj?.projectPath) {
      const fromPath = detectProjectStack(linkedProj.projectPath);
      if (fromPath.frameworkSlug !== "node" || fromPath.hasDockerfile) {
        stack = fromPath;
      }
    }

    const formatted = {
      ...pipeline,
      repoUrl: redactGitUrl(pipeline.repoUrl),
      autoDeploy: pipeline.autoDeploy && supportsGitHubPush(pipeline.repoUrl),
      framework: stack.framework,
      frameworkSlug: stack.frameworkSlug,
      language: stack.language,
      icon: stack.icon,
      colorClasses: stack.colorClasses,
      isDocker: stack.hasDockerfile || !!pipeline.dockerfilePath,
      deployment: linkedDep
        ? {
            id: linkedDep.id,
            status: linkedDep.status,
            deployUrl: linkedDep.deployUrl,
            hostPort: linkedDep.hostPort,
            containerName: linkedDep.containerName,
          }
        : null,
    };

    return NextResponse.json({ pipeline: formatted });
  } catch (err) {
    console.error("GET /api/cicd/[id]:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH /api/cicd/[id] — update pipeline configuration
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

    const resolvedParams = await params;
    const rawId = resolvedParams?.id;
    const id = rawId ? decodeURIComponent(rawId).trim() : "";
    if (!id) return NextResponse.json({ error: "Pipeline ID is required" }, { status: 400 });

    const { pipeline, forbidden } = await findAuthorizedPipeline(id, user, false);
    if (forbidden) {
      return NextResponse.json({ error: "Forbidden: You do not have permission to modify this pipeline" }, { status: 403 });
    }
    if (!pipeline) {
      return NextResponse.json({ error: `Pipeline not found: ${id}` }, { status: 404 });
    }

    const body = await req.json();

    if (body.autoDeploy === true && !supportsGitHubPush(pipeline.repoUrl)) return NextResponse.json({ error: "Automatic push triggers currently require GitHub. Run this external Git pipeline manually." }, { status: 400 });

    if (body.port !== undefined) {
      const portValidation = validateTcpPort(body.port);
      if (!portValidation.valid) {
        return NextResponse.json({ error: portValidation.error }, { status: 400 });
      }
    }

    if (body.branch !== undefined) {
      const branchStr = String(body.branch).trim();
      const { isValidGitBranch } = await import("@/lib/github-webhook");
      if (branchStr && !isValidGitBranch(branchStr)) {
        return NextResponse.json({ error: "Invalid target Git branch name" }, { status: 400 });
      }
    }

    if (body.port !== undefined && pipeline.projectId) {
      const saved = await readProjectSetup(pipeline.userId, pipeline.projectId);
      if (saved) {
        try { await saveProjectSetup(pipeline.userId, pipeline.projectId, validateSetupSource({ ...saved, hostPort: Number(body.port) })); }
        catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid setup port" }, { status: 400 }); }
      }
    }
    const updated = await prisma.rayPipeline.update({
      where: { id },
      data: {
        ...(body.branch !== undefined && { branch: String(body.branch).trim() }),
        ...(body.port !== undefined && { port: Number(body.port) }),
        ...(body.autoDeploy !== undefined && { autoDeploy: Boolean(body.autoDeploy) }),
        ...(body.dockerfilePath !== undefined && { dockerfilePath: String(body.dockerfilePath).trim() }),
      },
    });

    return NextResponse.json({ ok: true, pipeline: updated });
  } catch (err) {
    console.error("PATCH /api/cicd/[id]:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/cicd/[id] — trigger a pipeline run
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

    const resolvedParams = await params;
    const rawId = resolvedParams?.id;
    const id = rawId ? decodeURIComponent(rawId).trim() : "";
    if (!id) return NextResponse.json({ error: "Pipeline ID is required" }, { status: 400 });

    const { pipeline, forbidden } = await findAuthorizedPipeline(id, user, false);
    if (forbidden) {
      return NextResponse.json({ error: "Forbidden: You do not have permission to run this pipeline" }, { status: 403 });
    }
    if (!pipeline) {
      return NextResponse.json({ error: `Pipeline not found: ${id}` }, { status: 404 });
    }

    // Create a new PipelineRun record
    const run = await prisma.rayPipelineRun.create({
      data: {
        pipelineId: id,
        status: "running",
        commitHash: "manual-trigger",
        commitMessage: "Manual pipeline execution triggered from dashboard",
        author: user.name || "User",
        stages: JSON.stringify([
          { name: "Git Clone & Sync", status: "running", durationMs: 0 },
          { name: "Dependencies", status: "pending", durationMs: 0 },
          { name: "Security Audit", status: "pending", durationMs: 0 },
          { name: "Docker Build", status: "pending", durationMs: 0 },
          { name: "Container Deploy", status: "pending", durationMs: 0 },
          { name: "Healthcheck", status: "pending", durationMs: 0 },
        ]),
        logs: "Initiating pipeline execution...\nConnecting to repository: " + redactGitUrl(pipeline.repoUrl) + "\n",
      },
    });

    // Update pipeline status
    await prisma.rayPipeline.update({
      where: { id },
      data: { status: "running", lastRunAt: new Date() },
    });

    // Execute pipeline stages asynchronously via unified runner
    const { executePipelineRun } = await import("@/lib/cicd-runner");
    executePipelineRun({
      pipelineId: id,
      runId: run.id,
      userId: pipeline.userId || user.userId,
      overrideAuthor: user.name || undefined,
    }).catch((err) => {
      console.error("executePipelineRun error:", err);
    });

    return NextResponse.json({ ok: true, run });
  } catch (err) {
    console.error("POST /api/cicd/[id]:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

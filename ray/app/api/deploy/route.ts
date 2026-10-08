import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { validateTcpPort } from "@/lib/port-validator";
import { getAllReservedPorts } from "@/lib/port-config";
import { parseDeploymentEnvironment } from "@/lib/deployment-runtime";
import { signPreparedSource, verifyPreparedSource } from "@/lib/prepared-source";
import { resolveProjectSource } from "@/lib/project-source";
import { findDomainConflict } from "@/lib/domains";
import { parseProjectSetup } from "@/lib/project-setup";
import { readProjectSetup, saveProjectSetup, validateSetupSource, deploymentSetupPayload } from "@/lib/project-setup-store";
import { hostRuntimeHandle, requireStoppedRuntime } from "@/lib/host-runtime";
import { prepareGitSource } from "@/lib/git-prepare";
import prisma from "@/lib/prisma";
import { detectFramework } from "@/lib/framework-detection";

export const runtime = "nodejs";
export const maxDuration = 900;

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

// GET /api/deploy — list user's deployments
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("ray_token")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await verifyToken(token);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deployments = await prisma.rayDeployment.findMany({
      where: { userId: user.userId },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ deployments });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// POST /api/deploy — initiate container deployment and pipe SSE stream
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("ray_token")?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const user = await verifyToken(token);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const body = await req.json();
    const selectedProject = body.projectId ? await prisma.rayMonitorProject.findFirst({ where: { id: body.projectId, userId: user.userId } }) : null;
    if (body.projectId && !selectedProject) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (selectedProject && body.setup === undefined) {
      body.setup = await readProjectSetup(user.userId, selectedProject.id) || undefined;
    }
    let {
      name,
      projectPath,
      sourceType = "upload",
      repoUrl,
      branch = "main",
      commitHash,
      commitMessage,
      envVars,
    } = body;

    if (body.preparedSource === undefined && repoUrl) {
      const source = await prepareGitSource(user.userId, repoUrl, branch);
      body.preparedSource = await signPreparedSource(user.userId, source);
    }
    const prepared = body.preparedSource !== undefined;
    if (prepared) {
      try {
        const source = await verifyPreparedSource(body.preparedSource, user.userId);
        body.sourceRoot = source.sourceRoot;
        projectPath = resolveProjectSource(source.sourceRoot, body.setup?.appDirectory ?? body.appDirectory ?? ".").projectPath;
        repoUrl = source.repoUrl;
        branch = source.branch;
        commitHash = source.commitHash;
        sourceType = new URL(source.repoUrl).hostname === "github.com" ? "github" : "git";
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid repository setup." }, { status: 400 });
      }
    }

    if (body.setup && (sourceType === "github" || sourceType === "git") && !prepared && !selectedProject) {
      return NextResponse.json({ error: "Prepare the Git repository before submitting its setup." }, { status: 400 });
    }

    if (typeof name !== "string" || !name.trim() || name.length > 100 || typeof projectPath !== "string" || !projectPath.trim()) {
      return new Response(JSON.stringify({ error: "name and projectPath are required" }), { status: 400 });
    }

    let hostPort: number | undefined;
    if (body.hostPort !== undefined && body.hostPort !== null && body.hostPort !== "") {
      const validation = validateTcpPort(body.hostPort);
      if (!validation.valid || [...getAllReservedPorts(), 4567, 4500].includes(validation.port!)) {
        return NextResponse.json({ error: validation.error || "This port is reserved for the platform or a system service." }, { status: 400 });
      }
      hostPort = validation.port;
    }

    let containerPort: number | undefined;
    if (body.containerPort !== undefined && body.containerPort !== null && body.containerPort !== "") {
      const validation = validateTcpPort(body.containerPort);
      if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 400 });
      containerPort = validation.port;
    }
    try { parseDeploymentEnvironment(envVars == null ? null : JSON.stringify(envVars)); } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }

    let setup;
    try {
      const parsedSetup = parseProjectSetup({
        ...body.setup,
        sourceRoot: prepared ? body.sourceRoot : (body.setup?.sourceRoot || body.sourceRoot || projectPath),
        appDirectory: body.setup?.appDirectory ?? body.appDirectory ?? ".",
        hostPort: body.setup?.hostPort ?? hostPort,
        containerPort: body.setup?.containerPort ?? containerPort,
        envVars: body.setup?.envVars ?? envVars ?? {},
      });
      setup = validateSetupSource(parsedSetup);
      if (setup.framework === "auto") setup.framework = detectFramework(setup.projectPath)?.slug || "auto";
      deploymentSetupPayload(setup);
      projectPath = setup.projectPath;
      hostPort = setup.hostPort ?? undefined;
      containerPort = setup.containerPort ?? undefined;
      envVars = setup.envVars;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid setup" }, { status: 400 });
    }

    // Find or create matching monitor project to link so it is added to Projects
    let matchingProject = selectedProject || await prisma.rayMonitorProject.findFirst({
      where: {
        userId: user.userId,
        OR: [
          { name: name },
          { name: name.toLowerCase() },
          { projectPath: projectPath },
        ],
      },
    });

    if (setup.projectUrl) {
      const projects = await prisma.rayMonitorProject.findMany({ where: { userId: user.userId }, select: { id: true, name: true, projectUrl: true } });
      const conflict = findDomainConflict(setup.projectUrl, matchingProject?.id || "", projects);
      if (conflict.hasConflict) return NextResponse.json({ error: `Domain is already assigned to ${conflict.projectName}.` }, { status: 409 });
    }

    if (!matchingProject) {
      try {
        matchingProject = await prisma.rayMonitorProject.create({
          data: {
            userId: user.userId,
            name,
            projectPath,
            logPaths: "[]",
            projectUrl: setup.projectUrl || null,
            runCommand: setup.startCommand || null,
            status: "active",
          },
        });
      } catch (err) {
        console.warn("Could not auto-create monitor project:", err);
      }
    }

    if (!matchingProject) throw new Error("Could not create the project for this deployment.");
    const previousDeployment = await prisma.rayDeployment.findFirst({ where: { userId: user.userId, projectId: matchingProject.id, containerName: { not: null } }, orderBy: { updatedAt: "desc" } });
    try { requireStoppedRuntime(previousDeployment, setup.dockerEnabled); }
    catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 409 }); }
    await saveProjectSetup(user.userId, matchingProject.id, setup);

    // Create DB deployment record in "building" status
    const deployment = await prisma.rayDeployment.create({
      data: {
        userId: user.userId,
        projectId: matchingProject?.id || null,
        name,
        sourceType,
        repoUrl,
        branch,
        commitHash,
        commitMessage,
        projectPath,
        envVars: envVars ? JSON.stringify(envVars) : null,
        hostPort,
        containerPort: setup.dockerEnabled ? containerPort ?? null : null,
        ...(!setup.dockerEnabled ? { containerName: hostRuntimeHandle(user.userId, matchingProject.id) } : {}),
        status: "building",
        buildLogs: `[INIT] Starting application deployment for ${name}...\n`,
      },
    });

    // Auto-create CI/CD pipeline if deployment is from GitHub or is a Git repository
    const { ensureGitPipeline } = await import("@/lib/cicd-sync");
    await ensureGitPipeline(user.userId, name, repoUrl || projectPath, {
      branch,
      port: hostPort,
      projectId: matchingProject?.id || deployment.id,
    }).catch(() => {});

    const { getEffectiveGitHubToken } = await import("@/lib/github-app");
    const effectiveToken = prepared ? null : await getEffectiveGitHubToken(user.userId);

    // Proxy request to brain /v1/deploy
    const brainRes = await fetch(`${BRAIN_URL}/v1/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
      body: JSON.stringify({
        id: deployment.id,
        projectId: matchingProject.id,
        previousRuntime: previousDeployment?.containerName || undefined,
        userId: user.userId,
        name,
        projectPath,
        sourceType: prepared ? "local" : sourceType,
        repoUrl: prepared ? undefined : repoUrl,
        branch,
        githubToken: effectiveToken || undefined,
        ...deploymentSetupPayload(setup),
      }),
    });

    if (!brainRes.ok) {
      const errText = await brainRes.text();
      await prisma.rayDeployment.update({
        where: { id: deployment.id },
        data: { status: "failed", buildLogs: errText },
      });
      return new Response(JSON.stringify({ error: `Deployment failed: ${errText}` }), { status: 502 });
    }

    // Transform stream: accumulate logs, track errors, and update DB record asynchronously
    let accumulatedLogs = `[INIT] Starting application deployment for ${name}...\n`;
    const decoder = new TextDecoder();
    let eventBuffer = "";
    let runtimeRestored = false;
    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        controller.enqueue(chunk);
        eventBuffer += decoder.decode(chunk, { stream: true });
        const lines = eventBuffer.split("\n");
        eventBuffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.step === "rollback" && data.runtimeRestored && data.activeDeploymentId === deployment.id) runtimeRestored = true;
              if (data.logDelta) {
                accumulatedLogs += data.logDelta;
              } else if (data.message) {
                accumulatedLogs += `[${(data.step || "deploy").toUpperCase()}] ${data.message}\n`;
              }

              if (data.step === "complete") {
                await prisma.rayDeployment.update({
                  where: { id: deployment.id },
                  data: {
                    status: "healthy",
                    ...(data.runtime === "host" ? { projectPath: data.projectPath, containerId: null, imageName: null, containerPort: null } : {}),
                    deployUrl: data.url,
                    hostPort: data.port,
                    ...(data.containerPort ? { containerPort: data.containerPort } : {}),
                    containerName: data.container,
                    buildLogs: accumulatedLogs,
                  },
                });

                if (matchingProject) {
                  await prisma.rayMonitorProject.update({
                    where: { id: matchingProject.id },
                    data: {
                      projectPath: data.projectPath || projectPath,
                      runCommand: setup.startCommand || null,
                      projectUrl: setup.projectUrl || data.url || (data.port ? `http://localhost:${data.port}` : null),
                      status: "active",
                      ...(data.runtime === "host" ? { logPaths: JSON.stringify([data.logFile]), logCommand: null, managedPid: data.managedPid, managedLogFile: data.logFile } : data.container ? { logPaths: JSON.stringify([`docker:${data.container}`]), logCommand: null, managedPid: null, managedLogFile: null } : {}),
                      lastChecked: new Date(),
                    },
                  }).catch(() => {});
                }

                // Brain's mandatory pre-build gate already persisted the report.
              } else if (data.step === "failed" || data.status === "error") {
                await prisma.rayDeployment.update({
                  where: { id: deployment.id },
                  data: {
                    status: runtimeRestored ? "healthy" : "failed",
                    buildLogs: accumulatedLogs || data.message || "Deployment failed.",
                  },
                });
              }
            } catch { /* silent */ }
          }
        }
      },
      async flush() {
        try {
          const current = await prisma.rayDeployment.findUnique({ where: { id: deployment.id } });
          if (current && current.status === "building") {
            await prisma.rayDeployment.update({
              where: { id: deployment.id },
              data: {
                status: "failed",
                buildLogs: accumulatedLogs + "\n[Ray] Deployment stream closed before completion.",
              },
            });
          }
        } catch { /* silent */ }
      },
    });

    return new Response(brainRes.body?.pipeThrough(transformStream), {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Deployment-ID": deployment.id,
      },
    });
  } catch (err: unknown) {
    console.error("Deploy error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}

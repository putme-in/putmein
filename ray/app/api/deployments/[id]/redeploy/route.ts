import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { parseDeploymentEnvironment } from "@/lib/deployment-runtime";
import { readProjectSetup, validateSetupSource, deploymentSetupPayload } from "@/lib/project-setup-store";
import { hostRuntimeHandle, requireStoppedRuntime } from "@/lib/host-runtime";
import prisma from "@/lib/prisma";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

export const runtime = "nodejs";
export const maxDuration = 900;

// POST /api/deployments/[id]/redeploy — trigger rebuild and pipe live SSE progress
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    const user = await verifyToken(token);
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const { id } = await context.params;

    let deployment = await prisma.rayDeployment.findFirst({
      where: { id, userId: user.userId },
    });

    if (!deployment) {
      deployment = await prisma.rayDeployment.findFirst({
        where: {
          userId: user.userId,
          OR: [{ projectId: id }, { name: id }, { containerName: `ray-${id.toLowerCase()}` }],
        },
        orderBy: { createdAt: "desc" },
      });
    }

    if (!deployment) {
      return new Response(JSON.stringify({ error: "Deployment not found" }), { status: 404 });
    }

    const saved = deployment.projectId ? await readProjectSetup(user.userId, deployment.projectId) : null;
    let setup;
    try { setup = saved ? validateSetupSource(saved) : null; if (setup) { deploymentSetupPayload(setup); requireStoppedRuntime(deployment, setup.dockerEnabled); } }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid setup" }, { status: 400 }); }
    const envs = setup?.envVars ?? parseDeploymentEnvironment(deployment.envVars);

    // Reset status to building
    const initialLog = `[REDEPLOY] Initiating container rebuild for ${deployment.name}...\n`;
    await prisma.rayDeployment.update({
      where: { id: deployment.id },
      data: {
        status: "building",
        ...(setup && !setup.dockerEnabled && deployment.projectId ? { containerName: hostRuntimeHandle(user.userId, deployment.projectId), containerId: null, imageName: null, containerPort: null } : {}),
        buildLogs: initialLog,
        updatedAt: new Date(),
      },
    });

    // Proxy request to Brain /v1/deploy
    const brainRes = await fetch(`${BRAIN_URL}/v1/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
      body: JSON.stringify({
        id: deployment.id,
        projectId: deployment.projectId,
        previousRuntime: deployment.containerName,
        userId: user.userId,
        name: deployment.name,
        projectPath: setup?.projectPath || deployment.projectPath,
        sourceType: "local", // Rebuild the saved snapshot; CI/CD fetches new source.
        repoUrl: undefined,
        branch: deployment.branch,
        envVars: envs,
        containerPort: deployment.containerPort || undefined,
        hostPort: deployment.hostPort || undefined,
        ...(setup ? deploymentSetupPayload(setup) : {}),
      }),
    });

    if (!brainRes.ok) {
      const errText = await brainRes.text();
      await prisma.rayDeployment.update({
        where: { id: deployment.id },
        data: { status: "failed", buildLogs: `[ERROR] Failed to start rebuild: ${errText}` },
      });
      return new Response(JSON.stringify({ error: `Redeployment failed: ${errText}` }), { status: 502 });
    }

    let accumulatedLogs = initialLog;
    const depId = deployment.id;

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
              if (data.step === "rollback" && data.runtimeRestored && data.activeDeploymentId === depId) runtimeRestored = true;
              if (data.logDelta) {
                accumulatedLogs += data.logDelta;
              } else if (data.message) {
                accumulatedLogs += `[${(data.step || "deploy").toUpperCase()}] ${data.message}\n`;
              }

              if (data.step === "complete") {
                await prisma.rayDeployment.update({
                  where: { id: depId },
                  data: {
                    status: "healthy",
                        ...(data.runtime === "host" ? { containerId: null, imageName: null, containerPort: null } : {}),
                    ...(setup ? { projectPath: data.projectPath || setup.projectPath, envVars: JSON.stringify(setup.envVars) } : {}),
                    deployUrl: data.url,
                    hostPort: data.port,
                    ...(data.containerPort ? { containerPort: data.containerPort } : {}),
                    containerName: data.container,
                    buildLogs: accumulatedLogs,
                    updatedAt: new Date(),
                  },
                });
                if (setup && deployment.projectId) {
                  await prisma.rayMonitorProject.update({ where: { id: deployment.projectId }, data: {
                    projectPath: data.projectPath || setup.projectPath, projectUrl: setup.projectUrl || data.url,
                    runCommand: setup.startCommand || null,
                  } });
                }
              } else if (data.step === "failed" || data.status === "error") {
                await prisma.rayDeployment.update({
                  where: { id: depId },
                  data: {
                    status: runtimeRestored ? "healthy" : "failed",
                    buildLogs: accumulatedLogs || data.message || "Redeployment failed.",
                    updatedAt: new Date(),
                  },
                });
              }
            } catch { /* parse err */ }
          }
        }
      },
      async flush() {
        try {
          const current = await prisma.rayDeployment.findUnique({ where: { id: depId } });
          if (current && current.status === "building") {
            await prisma.rayDeployment.update({
              where: { id: depId },
              data: { status: "failed", buildLogs: accumulatedLogs + "\n[Ray] Redeployment stream ended before completion.", updatedAt: new Date() },
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
    console.error("Redeploy error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}

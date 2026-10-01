import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const cookieStore = await cookies();
  const token = cookieStore.get("ray_token")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await verifyToken(token);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let deployment = await prisma.rayDeployment.findFirst({
    where: { id, userId: user.userId },
  });

  let linkedPipelineRunId: string | null = null;
  let linkedPipelineId: string | null = null;

  if (!deployment) {
    // Check if id is a pipelineRun ID
    const run = await prisma.rayPipelineRun.findFirst({
      where: { id },
      include: { pipeline: true },
    });
    if (run?.pipeline) {
      linkedPipelineRunId = run.id;
      linkedPipelineId = run.pipelineId;
      deployment = await prisma.rayDeployment.findFirst({
        where: { name: run.pipeline.name, userId: user.userId },
      });

      // If no deployment record exists yet, create one for this pipeline project
      if (!deployment) {
        deployment = await prisma.rayDeployment.create({
          data: {
            userId: user.userId,
            name: run.pipeline.name,
            sourceType: "github",
            repoUrl: run.pipeline.repoUrl,
            branch: run.pipeline.branch || "main",
            projectPath: `/deployments/${run.pipeline.name}`,
            containerName: `ray-${run.pipeline.name.toLowerCase()}`,
            hostPort: run.pipeline.port && run.pipeline.port !== 4567 && run.pipeline.port !== 4500 ? run.pipeline.port : null,
            status: "building",
          },
        });
      }
    }
  }

  if (!deployment) {
    // Check if id is a pipeline ID
    const pipe = await prisma.rayPipeline.findFirst({
      where: { id, userId: user.userId },
    });
    if (pipe) {
      linkedPipelineId = pipe.id;
      deployment = await prisma.rayDeployment.findFirst({
        where: { name: pipe.name, userId: user.userId },
      });
      if (!deployment) {
        deployment = await prisma.rayDeployment.create({
          data: {
            userId: user.userId,
            name: pipe.name,
            sourceType: "github",
            repoUrl: pipe.repoUrl,
            branch: pipe.branch || "main",
            projectPath: `/deployments/${pipe.name}`,
            containerName: `ray-${pipe.name.toLowerCase()}`,
            hostPort: pipe.port && pipe.port !== 4567 && pipe.port !== 4500 ? pipe.port : null,
            status: "building",
          },
        });
      }
    }
  }

  if (!deployment) {
    // Check by name or containerName
    deployment = await prisma.rayDeployment.findFirst({
      where: {
        userId: user.userId,
        OR: [{ name: id }, { containerName: `ray-${id.toLowerCase()}` }],
      },
    });
  }

  if (!deployment) {
    return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
  }

  const targetDepId = deployment.id;

  const body = await req.json();
  const { action } = body; // "restart" | "stop" | "delete"

  if (action === "delete") {
    if (deployment.containerName) {
      try {
        await fetch(`${BRAIN_URL}/v1/deploy/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
          body: JSON.stringify({ action: "stop", container: deployment.containerName }),
        });
      } catch { /* silent */ }
    }
    await prisma.rayDeployment.delete({ where: { id: targetDepId } });
    return NextResponse.json({ status: "deleted" });
  }

  if (action === "redeploy") {
    // Reset status to building and record initial log
    await prisma.rayDeployment.update({
      where: { id: targetDepId },
      data: {
        status: "building",
        buildLogs: `[REDEPLOY] Initiating container rebuild and redeployment for ${deployment.name}...\n`,
        updatedAt: new Date(),
      },
    });

    if (linkedPipelineRunId) {
      await prisma.rayPipelineRun.update({
        where: { id: linkedPipelineRunId },
        data: { status: "running", logs: "Initiating container rebuild and redeployment..." },
      }).catch(() => {});
    }
    if (linkedPipelineId) {
      await prisma.rayPipeline.update({
        where: { id: linkedPipelineId },
        data: { status: "running" },
      }).catch(() => {});
    }

    // Asynchronously trigger Brain build and consume stream to keep DB synced
    (async () => {
      try {
        let envs: Record<string, string> | undefined;
        if (deployment.envVars) {
          try { envs = JSON.parse(deployment.envVars); } catch { /* ignore */ }
        }

        const { getEffectiveGitHubToken } = await import("@/lib/github-app");
        const effectiveToken = await getEffectiveGitHubToken(user.userId);

        const bRes = await fetch(`${BRAIN_URL}/v1/deploy`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
          body: JSON.stringify({
            id: deployment.id,
            userId: user.userId,
            name: deployment.name,
            projectPath: deployment.projectPath,
            sourceType: deployment.sourceType,
            repoUrl: deployment.repoUrl,
            branch: deployment.branch,
            githubToken: effectiveToken || undefined,
            envVars: envs,
            hostPort: deployment.hostPort && deployment.hostPort !== 4567 && deployment.hostPort !== 4500 ? deployment.hostPort : undefined,
          }),
        });

        if (!bRes.ok || !bRes.body) {
          const errTxt = await bRes.text().catch(() => "Failed to trigger Brain deployment");
          await prisma.rayDeployment.update({
            where: { id: targetDepId },
            data: { status: "failed", buildLogs: `[ERROR] Redeploy failed: ${errTxt}` },
          });
          if (linkedPipelineRunId) {
            await prisma.rayPipelineRun.update({
              where: { id: linkedPipelineRunId },
              data: { status: "failed", logs: `Redeploy failed: ${errTxt}` },
            }).catch(() => {});
          }
          if (linkedPipelineId) {
            await prisma.rayPipeline.update({
              where: { id: linkedPipelineId },
              data: { status: "failed" },
            }).catch(() => {});
          }
          return;
        }

        let logs = `[REDEPLOY] Initiating container rebuild for ${deployment.name}...\n`;
        const reader = bRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            for (const line of part.split("\n")) {
              if (line.startsWith("data: ")) {
                try {
                  const ev = JSON.parse(line.slice(6));
                  if (ev.logDelta) logs += ev.logDelta;
                  else if (ev.message) logs += `[${(ev.step || "deploy").toUpperCase()}] ${ev.message}\n`;

                  if (ev.step === "complete") {
                    await prisma.rayDeployment.update({
                      where: { id: targetDepId },
                      data: {
                        status: "healthy",
                        deployUrl: ev.url || deployment.deployUrl,
                        hostPort: ev.port || deployment.hostPort,
                        containerName: ev.container || deployment.containerName,
                        buildLogs: logs,
                        updatedAt: new Date(),
                      },
                    });
                    if (linkedPipelineRunId) {
                      await prisma.rayPipelineRun.update({
                        where: { id: linkedPipelineRunId },
                        data: { status: "success", logs: logs.slice(0, 5000) },
                      }).catch(() => {});
                    }
                    if (linkedPipelineId) {
                      await prisma.rayPipeline.update({
                        where: { id: linkedPipelineId },
                        data: { status: "success" },
                      }).catch(() => {});
                    }
                  } else if (ev.step === "failed" || ev.status === "error") {
                    await prisma.rayDeployment.update({
                      where: { id: targetDepId },
                      data: {
                        status: "failed",
                        buildLogs: logs || ev.message || "Redeployment failed.",
                        updatedAt: new Date(),
                      },
                    });
                    if (linkedPipelineRunId) {
                      await prisma.rayPipelineRun.update({
                        where: { id: linkedPipelineRunId },
                        data: { status: "failed", logs: (logs || ev.message || "Redeployment failed.").slice(0, 5000) },
                      }).catch(() => {});
                    }
                    if (linkedPipelineId) {
                      await prisma.rayPipeline.update({
                        where: { id: linkedPipelineId },
                        data: { status: "failed" },
                      }).catch(() => {});
                    }
                  }
                } catch { /* parse err */ }
              }
            }
          }
        }
      } catch (err: unknown) {
        await prisma.rayDeployment.update({
          where: { id: targetDepId },
          data: {
            status: "failed",
            buildLogs: `[ERROR] Redeploy exception: ${err instanceof Error ? err.message : "Unknown error"}`,
            updatedAt: new Date(),
          },
        }).catch(() => {});
        if (linkedPipelineRunId) {
          await prisma.rayPipelineRun.update({
            where: { id: linkedPipelineRunId },
            data: { status: "failed", logs: `Redeploy exception: ${err instanceof Error ? err.message : "Unknown error"}` },
          }).catch(() => {});
        }
        if (linkedPipelineId) {
          await prisma.rayPipeline.update({
            where: { id: linkedPipelineId },
            data: { status: "failed" },
          }).catch(() => {});
        }
      }
    })();

    return NextResponse.json({ status: "building", message: "Redeployment started" });
  }

  if (action === "cancel") {
    if (deployment.containerName) {
      try {
        await fetch(`${BRAIN_URL}/v1/deploy/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
          body: JSON.stringify({ action: "stop", container: deployment.containerName }),
        });
      } catch { /* silent */ }
    }

    const cancellationLog = (deployment.buildLogs || "") + "\n[CANCELLED] Deployment was cancelled by user.\n";
    await prisma.rayDeployment.update({
      where: { id: targetDepId },
      data: {
        status: "failed",
        buildLogs: cancellationLog,
        updatedAt: new Date(),
      },
    });

    // Update any linked active pipeline run to failed
    if (linkedPipelineRunId) {
      await prisma.rayPipelineRun.update({
        where: { id: linkedPipelineRunId },
        data: { status: "failed", logs: cancellationLog },
      }).catch(() => {});
    } else {
      const activeRun = await prisma.rayPipelineRun.findFirst({
        where: {
          pipeline: { userId: user.userId, name: deployment.name },
          status: "running",
        },
      });
      if (activeRun) {
        await prisma.rayPipelineRun.update({
          where: { id: activeRun.id },
          data: { status: "failed", logs: cancellationLog },
        }).catch(() => {});
      }
    }

    if (linkedPipelineId) {
      await prisma.rayPipeline.update({
        where: { id: linkedPipelineId },
        data: { status: "failed", lastRunAt: new Date() },
      }).catch(() => {});
    }

    return NextResponse.json({ status: "cancelled", message: "Deployment cancelled successfully" });
  }

  if (action === "restart" || action === "stop") {
    if (deployment.containerName) {
      try {
        const res = await fetch(`${BRAIN_URL}/v1/deploy/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
          body: JSON.stringify({ action, container: deployment.containerName }),
        });
        if (!res.ok && action === "restart") {
          return NextResponse.json({ error: "Action failed in container engine" }, { status: 500 });
        }
      } catch (containerErr) {
        if (action === "restart") {
          return NextResponse.json({ error: "Container engine unreachable" }, { status: 500 });
        }
      }
    }
    const newStatus = action === "restart" ? "healthy" : "stopped";
    await prisma.rayDeployment.update({
      where: { id: targetDepId },
      data: { status: newStatus },
    });
    return NextResponse.json({ status: newStatus });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

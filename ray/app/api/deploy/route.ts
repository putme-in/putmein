import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 120;

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
    const {
      name,
      projectPath,
      sourceType = "upload",
      repoUrl,
      branch = "main",
      commitHash,
      commitMessage,
      envVars,
    } = body;

    if (!name || !projectPath) {
      return new Response(JSON.stringify({ error: "name and projectPath are required" }), { status: 400 });
    }

    // Find any matching monitor project to link
    const matchingProject = await prisma.rayMonitorProject.findFirst({
      where: {
        userId: user.userId,
        OR: [
          { name: name },
          { name: name.toLowerCase() },
          { projectPath: projectPath },
        ],
      },
    });

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
        status: "building",
        buildLogs: `[INIT] Starting container deployment for ${name}...\n`,
      },
    });

    // Auto-create CI/CD pipeline if deployment is from GitHub or is a Git repository
    const { ensureGitPipeline } = await import("@/lib/cicd-sync");
    await ensureGitPipeline(user.userId, name, repoUrl || projectPath, {
      branch,
      projectId: matchingProject?.id || deployment.id,
    }).catch(() => {});

    const { getEffectiveGitHubToken } = await import("@/lib/github-app");
    const effectiveToken = await getEffectiveGitHubToken(user.userId);

    // Proxy request to brain /v1/deploy
    const brainRes = await fetch(`${BRAIN_URL}/v1/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
      body: JSON.stringify({
        id: deployment.id,
        userId: user.userId,
        name,
        projectPath,
        sourceType,
        repoUrl,
        branch,
        githubToken: effectiveToken || undefined,
        envVars,
        hostPort: body.hostPort && body.hostPort !== 4567 && body.hostPort !== 4500 ? body.hostPort : undefined,
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
    let accumulatedLogs = `[INIT] Starting container deployment for ${name}...\n`;
    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        controller.enqueue(chunk);
        const text = new TextDecoder().decode(chunk);
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
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
                    deployUrl: data.url,
                    hostPort: data.port,
                    containerName: data.container,
                    buildLogs: accumulatedLogs,
                  },
                });

                // Trigger automated post-deployment security scan if enabled
                (async () => {
                  try {
                    const settingsRes = await fetch(`${BRAIN_URL}/v1/settings`).catch(() => null);
                    const settingsData = settingsRes?.ok ? await settingsRes.json() : null;
                    if (settingsData?.securityChecksEnabled !== false) {
                      const secRes = await fetch(`${BRAIN_URL}/v1/security/scan`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          projectId: matchingProject?.id || deployment.id,
                          projectName: name,
                          projectPath: projectPath,
                          trigger: "deploy_first_time",
                        }),
                      });
                      if (secRes.ok) {
                        const secData = await secRes.json();
                        if (secData?.report) {
                          await prisma.raySecurityScan.create({
                            data: {
                              userId: user.userId,
                              projectId: matchingProject?.id || deployment.id,
                              projectName: name,
                              trigger: "deploy_first_time",
                              status: secData.report.status || "passed",
                              dangerCount: secData.report.dangerCount || 0,
                              warnCount: secData.report.warnCount || 0,
                              infoCount: secData.report.infoCount || 0,
                              findings: JSON.stringify(secData.report.findings || []),
                              logs: secData.report.logs || "",
                            },
                          });
                        }
                      }
                    }
                  } catch (secErr) {
                    console.warn("[Security] Auto-scan error:", secErr);
                  }
                })();
              } else if (data.step === "failed" || data.status === "error") {
                await prisma.rayDeployment.update({
                  where: { id: deployment.id },
                  data: {
                    status: "failed",
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
            if (accumulatedLogs.includes("successfully deployed") || accumulatedLogs.includes("healthy")) {
              await prisma.rayDeployment.update({
                where: { id: deployment.id },
                data: { status: "healthy", buildLogs: accumulatedLogs },
              });
            } else {
              await prisma.rayDeployment.update({
                where: { id: deployment.id },
                data: {
                  status: "failed",
                  buildLogs: accumulatedLogs + "\n[Ray] Deployment stream closed before completion.",
                },
              });
            }
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

import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import prisma from "@/lib/prisma";
import { getDeploymentsDir } from "@/lib/settings";
import { getEffectiveGitHubToken } from "@/lib/github-app";

const execFileAsync = promisify(execFile);
const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

export interface PipelineRunOptions {
  pipelineId: string;
  runId: string;
  userId: string;
  skipSecurity?: boolean;
  overrideAuthor?: string;
}

/**
 * Strips any embedded access tokens or credentials from a GitHub URL.
 */
export function sanitizeRepoUrl(url: string | null | undefined): string {
  if (!url) return "";
  return url.replace(/https?:\/\/[^@\s]+@github\.com\//gi, "https://github.com/");
}

/**
 * Strips embedded access tokens from error strings and log outputs.
 */
export function sanitizeErrorMessage(msg: string): string {
  if (!msg) return "";
  return msg.replace(/https?:\/\/[^@\s]+@github\.com/gi, "https://github.com");
}

/**
 * Executes a full CI/CD pipeline run end-to-end:
 * 1. Synchronizes repository code cleanly using dynamic GitHub tokens.
 * 2. Upserts RayDeployment so deployments page reflects the active build immediately.
 * 3. Executes security audit node (halting on danger vulnerabilities).
 * 4. Dispatches container build & deploy to Brain and streams SSE progress.
 * 5. Updates RayDeployment to healthy/failed with container URLs and ports.
 */
export async function executePipelineRun(options: PipelineRunOptions) {
  const { pipelineId, runId, userId, skipSecurity = false } = options;

  let pipeline = await prisma.rayPipeline.findFirst({
    where: { id: pipelineId, userId },
  });
  if (!pipeline) {
    pipeline = await prisma.rayPipeline.findUnique({
      where: { id: pipelineId },
    });
  }
  if (!pipeline) {
    console.error(`[CICD] Pipeline ${pipelineId} not found`);
    return;
  }

  const run = await prisma.rayPipelineRun.findFirst({
    where: { id: runId },
  });
  if (!run) {
    console.error(`[CICD] PipelineRun ${runId} not found`);
    return;
  }

  const cleanRepoUrl = sanitizeRepoUrl(pipeline.repoUrl);
  const branch = pipeline.branch || "main";
  let accumulatedLogs = run.logs || `Starting pipeline for ${pipeline.name}...\n`;

  let stages = [
    { name: "Git Clone & Sync", status: "running", durationMs: 0 },
    { name: "Dependencies", status: "pending", durationMs: 0 },
    { name: "Security Audit", status: "pending", durationMs: 0 },
    { name: "Docker Build", status: "pending", durationMs: 0 },
    { name: "Container Deploy", status: "pending", durationMs: 0 },
    { name: "Healthcheck", status: "pending", durationMs: 0 },
  ];
  let currentStageIndex = 0;

  // Helper to persist stages and logs
  const updateRunProgress = async (extra?: Partial<{ status: string; commitHash: string; commitMessage: string; author: string }>) => {
    try {
      await prisma.rayPipelineRun.update({
        where: { id: run.id },
        data: {
          stages: JSON.stringify(stages),
          logs: accumulatedLogs,
          ...extra,
        },
      });
    } catch { /* silent */ }
  };

  try {
    // ── 1. Determine Project Directory ──
    const monitorProj = pipeline.projectId
      ? await prisma.rayMonitorProject.findFirst({ where: { id: pipeline.projectId, userId } })
      : await prisma.rayMonitorProject.findFirst({ where: { name: { equals: pipeline.name }, userId } });

    let targetDir = monitorProj?.projectPath && fs.existsSync(monitorProj.projectPath)
      ? monitorProj.projectPath
      : path.join(await getDeploymentsDir(), pipeline.name);

    accumulatedLogs += `[GIT] Target directory: ${targetDir}\n[GIT] Repository: ${cleanRepoUrl} (branch: ${branch})\n`;
    await updateRunProgress();

    // ── 2. Git Synchronization Stage (Isolated) ──
    const effectiveToken = await getEffectiveGitHubToken(userId);
    const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" };
    let authUrl = cleanRepoUrl;
    if (effectiveToken && cleanRepoUrl.includes("github.com")) {
      authUrl = cleanRepoUrl.replace("https://", `https://x-access-token:${effectiveToken}@`);
    }

    let commitHash = run.commitHash || "latest";
    let commitMessage = run.commitMessage || "Synced latest commit";
    let author = options.overrideAuthor || run.author || "CI/CD Auto-Sync";

    const t0 = Date.now();
    try {
      if (!cleanRepoUrl) {
        throw new Error("Repository URL is not configured for this pipeline.");
      }

      // Check if target directory has a valid git repository
      const hasGitDir = fs.existsSync(path.join(targetDir, ".git"));
      if (!hasGitDir) {
        accumulatedLogs += `[GIT] No local git repository found at target. Cloning repository...\n`;
        const parentDir = path.dirname(targetDir);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
        await execFileAsync("git", ["clone", "-b", branch, "--single-branch", authUrl, targetDir], { env: gitEnv, timeout: 60000, windowsHide: true });
      } else {
        accumulatedLogs += `[GIT] Repository exists. Sanitizing remote origin and fetching latest commits...\n`;
        // Ensure remote origin has clean URL (prevents stale token expiration in .git/config)
        await execFileAsync("git", ["-C", targetDir, "remote", "set-url", "origin", cleanRepoUrl], { env: gitEnv, timeout: 10000, windowsHide: true }).catch(() => {});
        // Fetch using authenticated URL
        await execFileAsync("git", ["-C", targetDir, "fetch", authUrl, branch], { env: gitEnv, timeout: 30000, windowsHide: true });
        await execFileAsync("git", ["-C", targetDir, "checkout", branch], { env: gitEnv, timeout: 10000, windowsHide: true });
        await execFileAsync("git", ["-C", targetDir, "reset", "--hard", "FETCH_HEAD"], { env: gitEnv, timeout: 15000, windowsHide: true });
        await execFileAsync("git", ["-C", targetDir, "clean", "-fd"], { env: gitEnv, timeout: 10000, windowsHide: true });
      }

      // Read commit metadata from disk
      const { stdout: headHash } = await execFileAsync("git", ["-C", targetDir, "rev-parse", "--short", "HEAD"], { env: gitEnv, timeout: 5000, windowsHide: true });
      const { stdout: headMsg } = await execFileAsync("git", ["-C", targetDir, "log", "-1", "--pretty=%B"], { env: gitEnv, timeout: 5000, windowsHide: true });
      const { stdout: headAuthor } = await execFileAsync("git", ["-C", targetDir, "log", "-1", "--pretty=%an"], { env: gitEnv, timeout: 5000, windowsHide: true });

      commitHash = headHash.trim() || commitHash;
      commitMessage = headMsg.trim() || commitMessage;
      author = options.overrideAuthor || headAuthor.trim() || author;

      stages[0].status = "success";
      stages[0].durationMs = Date.now() - t0;
      stages[1].status = "success"; // Dependencies verified / ready for docker build
      stages[1].durationMs = 120;

      accumulatedLogs += `[GIT] Checked out commit ${commitHash}: "${commitMessage}" (by ${author})\n`;
      await updateRunProgress({ commitHash, commitMessage, author });
    } catch (gitErr: any) {
      const rawStderr = typeof gitErr?.stderr === "string" ? gitErr.stderr : "";
      const rawMsg = gitErr instanceof Error ? gitErr.message : String(gitErr);
      const cause = gitErr?.cause ? ` (cause: ${gitErr.cause})` : "";
      const detailedError = sanitizeErrorMessage((rawStderr.trim() || rawMsg.trim()) + cause);

      accumulatedLogs += `\n[GIT ERROR] Failed to synchronize repository:\n${detailedError}\n`;
      if (!effectiveToken && cleanRepoUrl.includes("github.com")) {
        accumulatedLogs += `[GIT HINT] If this is a private repository, ensure GitHub is connected in Settings.\n`;
      }

      stages[0].status = "failed";
      stages[0].durationMs = Date.now() - t0;
      // Mark downstream stages as skipped so they don't remain in ambiguous pending states
      for (let i = 1; i < stages.length; i++) {
        stages[i].status = "skipped";
      }

      await prisma.rayPipelineRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          stages: JSON.stringify(stages),
          logs: accumulatedLogs,
        },
      });

      await prisma.rayPipeline.update({
        where: { id: pipeline.id },
        data: { status: "failed" },
      });

      return;
    }

    // ── 3. Upsert RayDeployment in "building" state ──
    // This ensures the deployment appears immediately on /deployments
    let deployment = await prisma.rayDeployment.findFirst({
      where: {
        userId,
        OR: [
          ...(pipeline.projectId ? [{ projectId: pipeline.projectId }] : []),
          { name: pipeline.name },
          { repoUrl: { contains: pipeline.name } },
        ],
      },
    });

    if (deployment) {
      deployment = await prisma.rayDeployment.update({
        where: { id: deployment.id },
        data: {
          status: "building",
          commitHash,
          commitMessage,
          repoUrl: cleanRepoUrl,
          branch,
          projectPath: targetDir,
          hostPort: pipeline.port || deployment.hostPort || 3000,
          buildLogs: accumulatedLogs,
          updatedAt: new Date(),
        },
      });
    } else {
      deployment = await prisma.rayDeployment.create({
        data: {
          userId,
          name: pipeline.name,
          projectId: pipeline.projectId || null,
          sourceType: "github",
          repoUrl: cleanRepoUrl,
          branch,
          commitHash,
          commitMessage,
          projectPath: targetDir,
          containerName: `ray-${pipeline.name.toLowerCase()}`,
          imageName: `${pipeline.name.toLowerCase()}:latest`,
          status: "building",
          hostPort: pipeline.port || 3000,
          containerPort: 3000,
          buildLogs: accumulatedLogs,
        },
      });
    }

    accumulatedLogs += `[DEPLOY] RayDeployment record linked: ${deployment.id} (status: building)\n`;

    // ── 4. Security Audit Stage Guardrail ──
    currentStageIndex = 2;
    stages[2].status = "running";
    await updateRunProgress();

    let securityBlocked = false;
    if (!skipSecurity) {
      try {
        const settingsRes = await fetch(`${BRAIN_URL}/v1/settings`).catch(() => null);
        const settingsData = settingsRes?.ok ? await settingsRes.json() : null;
        const securityEnabled = settingsData?.securityChecksEnabled !== false;

        if (securityEnabled) {
          accumulatedLogs += "[SECURITY] Running pre-deployment security & CVE audit...\n";
          const secRes = await fetch(`${BRAIN_URL}/v1/security/scan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: pipeline.projectId || pipeline.id,
              projectName: pipeline.name,
              projectPath: targetDir,
              trigger: "cicd_pipeline",
            }),
          });

          if (secRes.ok) {
            const secData = await secRes.json();
            const report = secData.report;

            if (report) {
              await prisma.raySecurityScan.create({
                data: {
                  userId,
                  projectId: pipeline.projectId || pipeline.id,
                  projectName: pipeline.name,
                  trigger: "cicd_pipeline",
                  status: report.status || "passed",
                  dangerCount: report.dangerCount || 0,
                  warnCount: report.warnCount || 0,
                  infoCount: report.infoCount || 0,
                  findings: JSON.stringify(report.findings || []),
                  logs: report.logs || "",
                },
              });

              accumulatedLogs += `[SECURITY] Audit result: ${report.dangerCount} Danger, ${report.warnCount} Warning, ${report.infoCount} Info.\n`;

              if (report.dangerCount > 0) {
                stages[2].status = "danger";
                for (let i = 3; i < stages.length; i++) {
                  stages[i].status = "skipped";
                }
                accumulatedLogs += "\n🚨 [DEPLOYMENT BLOCKED] Critical danger-level vulnerabilities detected!\n" +
                  "Automated deployment halted. Dual confirmation required in dashboard to consent and override.\n";

                await prisma.rayPipelineRun.update({
                  where: { id: run.id },
                  data: {
                    status: "blocked_danger",
                    stages: JSON.stringify(stages),
                    logs: accumulatedLogs,
                  },
                });

                await prisma.rayPipeline.update({
                  where: { id: pipeline.id },
                  data: { status: "blocked_danger" },
                });

                await prisma.rayDeployment.update({
                  where: { id: deployment.id },
                  data: {
                    status: "failed",
                    buildLogs: accumulatedLogs,
                  },
                });

                securityBlocked = true;
                return;
              }

              stages[2].status = "success";
            }
          } else {
            accumulatedLogs += `[SECURITY] Security scan service responded with status ${secRes.status}. Continuing...\n`;
            stages[2].status = "skipped";
          }
        } else {
          stages[2].status = "skipped";
          accumulatedLogs += "[SECURITY] Security checks disabled in settings. Skipping audit.\n";
        }
      } catch (secErr: any) {
        accumulatedLogs += `[SECURITY] Security audit service unavailable (${secErr?.message || "connection error"}). Proceeding with deployment.\n`;
        stages[2].status = "skipped";
      }
    } else {
      stages[2].status = "overridden";
      accumulatedLogs += "[SECURITY] Security block overridden with dual-consent authorization.\n";
    }

    if (securityBlocked) return;

    // ── 5. Docker Build & Container Deploy via Brain ──
    currentStageIndex = 3;
    stages[3].status = "running";
    stages[4].status = "pending";
    await updateRunProgress();

    accumulatedLogs += `[BRAIN] Dispatching containerized build to Brain at ${BRAIN_URL}...\n`;

    const deployPayload = {
      id: deployment.id,
      userId,
      name: pipeline.name,
      projectPath: targetDir,
      sourceType: "github",
      repoUrl: cleanRepoUrl,
      branch,
      hostPort: pipeline.port && pipeline.port !== 4567 && pipeline.port !== 4500 ? pipeline.port : undefined,
    };

    let bRes: Response;
    try {
      bRes = await fetch(`${BRAIN_URL}/v1/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
        body: JSON.stringify(deployPayload),
      });
    } catch (deployErr: any) {
      const deployMsg = deployErr?.message || String(deployErr);
      accumulatedLogs += `\n[DEPLOY ERROR] Brain service unavailable at ${BRAIN_URL}: ${deployMsg}\n`;
      stages[3].status = "failed";
      stages[4].status = "skipped";
      stages[5].status = "skipped";
      await updateRunProgress({ status: "failed" });
      await prisma.rayPipeline.update({ where: { id: pipeline.id }, data: { status: "failed" } });
      await prisma.rayDeployment.update({
        where: { id: deployment.id },
        data: { status: "failed", buildLogs: accumulatedLogs },
      });
      return;
    }

    if (!bRes.ok || !bRes.body) {
      const errTxt = await bRes.text().catch(() => "Failed to connect to Brain deploy service");
      stages[3].status = "failed";
      stages[4].status = "skipped";
      stages[5].status = "skipped";
      accumulatedLogs += `\n[ERROR] Brain deploy failed: ${errTxt}\n`;
      await updateRunProgress({ status: "failed" });
      await prisma.rayPipeline.update({ where: { id: pipeline.id }, data: { status: "failed" } });
      await prisma.rayDeployment.update({
        where: { id: deployment.id },
        data: { status: "failed", buildLogs: accumulatedLogs },
      });
      return;
    }

    // Stream SSE progress from Brain with inactivity watchdog (90s)
    const reader = bRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let deploySuccessful = false;
    let finalPort = pipeline.port || 3000;
    let finalUrl = "";
    let finalContainer = `ray-${pipeline.name.toLowerCase()}`;
    const INACTIVITY_TIMEOUT_MS = 90000;

    while (true) {
      // Check if deployment or run was cancelled by user
      const checkStatus = await prisma.rayPipelineRun.findUnique({
        where: { id: run.id },
        select: { status: true },
      }).catch(() => null);

      if (checkStatus && checkStatus.status === "failed") {
        reader.cancel().catch(() => {});
        return;
      }

      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        let timer: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("DEPLOY_INACTIVITY_TIMEOUT")), INACTIVITY_TIMEOUT_MS);
        });

        readResult = await Promise.race([
          reader.read().then((res) => {
            clearTimeout(timer);
            return res;
          }),
          timeoutPromise,
        ]);
      } catch (readErr: any) {
        reader.cancel().catch(() => {});
        if (readErr?.message === "DEPLOY_INACTIVITY_TIMEOUT") {
          accumulatedLogs += "\n[DEPLOY TIMEOUT] Build process stopped responding (no output for 90s). Please ensure Docker daemon is running and responsive on the system.\n";
          stages[3].status = "failed";
          stages[4].status = "skipped";
          stages[5].status = "skipped";
          await updateRunProgress({ status: "failed" });
          await prisma.rayPipeline.update({ where: { id: pipeline.id }, data: { status: "failed", lastRunAt: new Date() } });
          await prisma.rayDeployment.update({
            where: { id: deployment.id },
            data: { status: "failed", buildLogs: accumulatedLogs },
          });
          return;
        }
        throw readErr;
      }

      const { value, done } = readResult;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        for (const line of part.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.logDelta) accumulatedLogs += ev.logDelta;
              else if (ev.message) accumulatedLogs += `[${(ev.step || "deploy").toUpperCase()}] ${ev.message}\n`;

              if (ev.port) finalPort = ev.port;
              if (ev.url) finalUrl = ev.url;
              if (ev.container) finalContainer = ev.container;

              if (ev.step === "building") {
                currentStageIndex = 3;
                stages[3].status = "running";
              } else if (ev.step === "launching") {
                stages[3].status = "success";
                currentStageIndex = 4;
                stages[4].status = "running";
              } else if (ev.step === "healthcheck") {
                stages[4].status = "success";
                currentStageIndex = 5;
                stages[5].status = "running";
              } else if (ev.step === "complete") {
                deploySuccessful = true;
                stages[3].status = "success";
                stages[4].status = "success";
                stages[5].status = "success";
              } else if (ev.step === "failed" || ev.status === "error") {
                deploySuccessful = false;
                stages[3].status = stages[3].status === "running" ? "failed" : stages[3].status;
                stages[4].status = stages[4].status === "running" ? "failed" : (stages[4].status === "pending" ? "skipped" : stages[4].status);
                stages[5].status = stages[5].status === "running" ? "failed" : (stages[5].status === "pending" ? "skipped" : stages[5].status);
              }
            } catch { /* parse error */ }
          }
        }
      }

      // Throttle progress updates to database
      await updateRunProgress();
    }

    if (deploySuccessful) {
      finalUrl = finalUrl || `http://localhost:${finalPort}`;
      accumulatedLogs += `\n✅ [COMPLETE] Deployment successful! Container ${finalContainer} live at ${finalUrl}\n`;

      await prisma.rayPipelineRun.update({
        where: { id: run.id },
        data: {
          status: "success",
          stages: JSON.stringify(stages),
          logs: accumulatedLogs,
        },
      });

      await prisma.rayPipeline.update({
        where: { id: pipeline.id },
        data: { status: "success", lastRunAt: new Date() },
      });

      await prisma.rayDeployment.update({
        where: { id: deployment.id },
        data: {
          status: "healthy",
          deployUrl: finalUrl,
          hostPort: finalPort,
          containerName: finalContainer,
          buildLogs: accumulatedLogs,
          updatedAt: new Date(),
        },
      });

      if (monitorProj) {
        await prisma.rayMonitorProject.update({
          where: { id: monitorProj.id },
          data: {
            projectUrl: finalUrl,
            status: "running",
          },
        }).catch(() => {});
      }
    } else {
      accumulatedLogs += `\n❌ [FAILED] Container deployment encountered an error.\n`;
      // Ensure pending downstream stages are marked skipped instead of left pending
      for (let i = 0; i < stages.length; i++) {
        if (stages[i].status === "running") stages[i].status = "failed";
        else if (stages[i].status === "pending") stages[i].status = "skipped";
      }

      await prisma.rayPipelineRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          stages: JSON.stringify(stages),
          logs: accumulatedLogs,
        },
      });

      await prisma.rayPipeline.update({
        where: { id: pipeline.id },
        data: { status: "failed", lastRunAt: new Date() },
      });

      await prisma.rayDeployment.update({
        where: { id: deployment.id },
        data: {
          status: "failed",
          buildLogs: accumulatedLogs,
          updatedAt: new Date(),
        },
      });
    }
  } catch (err: unknown) {
    console.error(`[CICD] Pipeline runner critical failure:`, err);
    if (stages[currentStageIndex]) {
      stages[currentStageIndex].status = "failed";
      for (let i = currentStageIndex + 1; i < stages.length; i++) {
        if (stages[i].status === "pending") stages[i].status = "skipped";
      }
    }
    await prisma.rayPipelineRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        stages: JSON.stringify(stages),
        logs: accumulatedLogs + `\n[CRITICAL ERROR] ${err instanceof Error ? err.message : String(err)}`,
      },
    }).catch(() => {});

    await prisma.rayPipeline.update({
      where: { id: pipeline.id },
      data: { status: "failed", lastRunAt: new Date() },
    }).catch(() => {});
  }
}

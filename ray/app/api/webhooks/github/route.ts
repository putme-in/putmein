import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyGithubWebhookSignature, isValidGitBranch } from "@/lib/github-webhook";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { getDeploymentsDir } from "@/lib/settings";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256");
    const event = req.headers.get("x-github-event");

    if (!signature) {
      return NextResponse.json({ error: "Missing webhook signature" }, { status: 401 });
    }

    const allIntegrations = await prisma.rayGithubIntegration.findMany({
      select: { webhookSecret: true },
    });
    const candidateSecrets = [
      process.env.GITHUB_WEBHOOK_SECRET,
      ...allIntegrations.map((i) => i.webhookSecret),
    ].filter(Boolean) as string[];

    if (candidateSecrets.length === 0 || !candidateSecrets.some((secret) =>
      verifyGithubWebhookSignature(rawBody, signature, secret)
    )) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    let payload: {
      repository?: { full_name?: string; clone_url?: string };
      ref?: string;
      head_commit?: { id?: string; message?: string; author?: { name?: string } };
      pusher?: { name?: string };
    };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
    }

    const repoFullName = payload.repository?.full_name;
    const cloneUrl = payload.repository?.clone_url;
    const rawBranch = payload.ref ? payload.ref.replace(/^refs\/heads\//, "") : undefined;
    const headCommit = payload.head_commit;

    if (!repoFullName || !cloneUrl) {
      return NextResponse.json({ error: "No repository in payload" }, { status: 400 });
    }

    if (rawBranch && !isValidGitBranch(rawBranch)) {
      return NextResponse.json({ error: "Invalid branch reference in webhook payload" }, { status: 400 });
    }
    const branch = rawBranch;

    // 1. Find matching pipelines and deployments for this repository
    const shortRepoName = repoFullName.split("/").pop() || repoFullName;
    const [deployments, pipelines] = await Promise.all([
      prisma.rayDeployment.findMany({
        where: {
          OR: [
            { repoUrl: { contains: repoFullName } },
            { repoUrl: { contains: shortRepoName } },
            { name: { equals: shortRepoName } },
          ],
        },
        include: { user: true },
      }),
      prisma.rayPipeline.findMany({
        where: {
          OR: [
            { repoUrl: { contains: repoFullName } },
            { repoUrl: { contains: shortRepoName } },
            { name: { equals: shortRepoName } },
          ],
        },
        include: { user: true },
      }),
    ]);

    if (deployments.length === 0 && pipelines.length === 0) {
      return NextResponse.json({ message: "No matching deployment or pipeline registered for this repository" });
    }

    const userIds = [...new Set([...deployments, ...pipelines].map(({ userId }) => userId))];
    const integrations: Array<{ webhookSecret: string | null }> = await prisma.rayGithubIntegration.findMany({
      where: { userId: { in: userIds } },
      select: { webhookSecret: true },
    });
    const repoCandidateSecrets = [
      process.env.GITHUB_WEBHOOK_SECRET,
      ...integrations.map((i) => i.webhookSecret),
    ].filter(Boolean) as string[];

    const signatureValid = repoCandidateSecrets.length > 0 && repoCandidateSecrets.some((secret) =>
      verifyGithubWebhookSignature(rawBody, signature, secret)
    );

    if (!signatureValid) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    if (event !== "push") {
      return NextResponse.json({ message: `Ignored event: ${event}` });
    }

    const baseDeployDir = await getDeploymentsDir();

    const results = [];

    // Trigger CI/CD Pipelines
    const triggeredPipelineNames = new Set<string>();
    for (const pipe of pipelines) {
      if (!pipe.autoDeploy) continue;
      triggeredPipelineNames.add(pipe.name.toLowerCase());

      const run = await prisma.rayPipelineRun.create({
        data: {
          pipelineId: pipe.id,
          commitHash: headCommit?.id ? headCommit.id.slice(0, 7) : "push-trigger",
          commitMessage: headCommit?.message || `Pushed to ${branch}`,
          author: headCommit?.author?.name || payload.pusher?.name || "GitHub Push",
          status: "running",
          stages: JSON.stringify([
            { name: "Git Clone & Sync", status: "running", durationMs: 0 },
            { name: "Dependencies", status: "pending", durationMs: 0 },
            { name: "Security Audit", status: "pending", durationMs: 0 },
            { name: "Docker Build", status: "pending", durationMs: 0 },
            { name: "Container Deploy", status: "pending", durationMs: 0 },
            { name: "Healthcheck", status: "pending", durationMs: 0 },
          ]),
          logs: `Webhook received for ${repoFullName} (${branch})\nCommit: ${headCommit?.id || "latest"} - ${headCommit?.message || ""}\n`,
        },
      });

      await prisma.rayPipeline.update({
        where: { id: pipe.id },
        data: { status: "running", lastRunAt: new Date() },
      });

      const { executePipelineRun } = await import("@/lib/cicd-runner");
      executePipelineRun({
        pipelineId: pipe.id,
        runId: run.id,
        userId: pipe.userId,
        overrideAuthor: headCommit?.author?.name || payload.pusher?.name || undefined,
      }).catch((e) => console.error("Pipeline auto-deploy error:", e));

      results.push({ pipelineId: pipe.id, name: pipe.name, runId: run.id, status: "building" });
    }

    // Trigger Standalone Deployments (if not already handled by a pipeline above)
    for (const dep of deployments) {
      if (triggeredPipelineNames.has(dep.name.toLowerCase())) continue;

      const targetDir = dep.projectPath || path.join(baseDeployDir, dep.name);
      const { getEffectiveGitHubToken } = await import("@/lib/github-app");
      const effectiveToken = await getEffectiveGitHubToken(dep.userId);
      const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" };

      let authUrl = cloneUrl;
      if (effectiveToken && cloneUrl.includes("github.com")) {
        authUrl = cloneUrl.replace("https://", `https://x-access-token:${effectiveToken}@`);
      }

      const safeBranch = (branch && isValidGitBranch(branch) ? branch : dep.branch) || "main";

      try {
        if (!fs.existsSync(targetDir)) {
          await execFileAsync("git", ["clone", "-b", safeBranch, "--single-branch", authUrl, targetDir], { env: gitEnv, windowsHide: true });
        } else {
          await execFileAsync("git", ["-C", targetDir, "remote", "set-url", "origin", cloneUrl], { env: gitEnv, windowsHide: true }).catch(() => {});
          await execFileAsync("git", ["-C", targetDir, "fetch", authUrl, safeBranch], { env: gitEnv, windowsHide: true });
          await execFileAsync("git", ["-C", targetDir, "checkout", safeBranch], { env: gitEnv, windowsHide: true });
          await execFileAsync("git", ["-C", targetDir, "reset", "--hard", "FETCH_HEAD"], { env: gitEnv, windowsHide: true });
          await execFileAsync("git", ["-C", targetDir, "clean", "-fd"], { env: gitEnv, windowsHide: true });
        }
      } catch (gitErr) {
        console.error(`Git sync error for deployment ${dep.name}:`, gitErr);
      }

      // Update deployment record to building status
      await prisma.rayDeployment.update({
        where: { id: dep.id },
        data: {
          status: "building",
          commitHash: headCommit?.id ? headCommit.id.slice(0, 7) : null,
          commitMessage: headCommit?.message || "Triggered via git push",
        },
      });

      // Trigger build via brain /v1/deploy in background
      fetch(`${BRAIN_URL}/v1/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
        body: JSON.stringify({
          id: dep.id,
          userId: dep.userId,
          name: dep.name,
          projectPath: targetDir,
          sourceType: "github",
          repoUrl: cloneUrl,
          branch: safeBranch,
        }),
      }).catch((e) => console.error("Auto-deploy error:", e));

      results.push({ deploymentId: dep.id, name: dep.name, status: "redeploying" });
    }

    return NextResponse.json({ success: true, triggered: results });
  } catch (err: unknown) {
    console.error("Webhook processing error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

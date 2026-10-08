import { NextRequest, NextResponse } from "next/server";
import { readProjectSetup } from "@/lib/project-setup-store";
import { ensureGitPipeline } from "@/lib/cicd-sync";
import prisma from "@/lib/prisma";
import { verifyGithubWebhookSignature, isValidGitBranch } from "@/lib/github-webhook";
import path from "path";
import fs from "fs";
import { getDeploymentsDir } from "@/lib/settings";

import { cloneGitSource } from "@/lib/git-source";
import { gitRepositoryKey } from "@/lib/git-url";

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
      select: { webhookSecret: true, userId: true },
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

    const globalAuthorized = !!process.env.GITHUB_WEBHOOK_SECRET && verifyGithubWebhookSignature(rawBody, signature, process.env.GITHUB_WEBHOOK_SECRET);
    const authorizedOwners = allIntegrations.filter(integration => integration.webhookSecret && verifyGithubWebhookSignature(rawBody, signature, integration.webhookSecret)).map(integration => integration.userId);
    const ownerScope = globalAuthorized ? {} : { userId: { in: authorizedOwners } };

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

    try {
      if (gitRepositoryKey(cloneUrl) !== gitRepositoryKey(`https://github.com/${repoFullName}`)) throw new Error();
    } catch { return NextResponse.json({ error: "Repository clone URL does not match the GitHub payload" }, { status: 400 }); }

    if (rawBranch && !isValidGitBranch(rawBranch)) {
      return NextResponse.json({ error: "Invalid branch reference in webhook payload" }, { status: 400 });
    }
    const branch = rawBranch;

    // 1. Find matching pipelines and deployments for this repository
    const [deployments, pipelines] = await Promise.all([
      prisma.rayDeployment.findMany({
        where: {
          ...ownerScope,
          repoUrl: { in: [`https://github.com/${repoFullName}`, `https://github.com/${repoFullName}.git`] },
        },
      }),
      prisma.rayPipeline.findMany({
        where: {
          ...ownerScope,
          repoUrl: { in: [`https://github.com/${repoFullName}`, `https://github.com/${repoFullName}.git`] },
        },
      }),
    ]);

    if (deployments.length === 0 && pipelines.length === 0) {
      return NextResponse.json({ message: "No matching deployment or pipeline registered for this repository" });
    }

    const userIds = [...new Set([...deployments, ...pipelines].map(({ userId }) => userId))];
    const integrations: Array<{ webhookSecret: string | null }> = await prisma.rayGithubIntegration.findMany({
      where: { userId: { in: userIds } },
      select: { webhookSecret: true, userId: true },
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

    if (event !== "push" || !payload.ref?.startsWith("refs/heads/")) {
      return NextResponse.json({ message: `Ignored event: ${event}` });
    }

    const baseDeployDir = await getDeploymentsDir();

    const results = [];

    // Reconcile configured projects before dispatch. They must use the runner
    // that understands their application directory and saved runtime settings.
    for (const dep of deployments) {
      if (!dep.projectId || !await readProjectSetup(dep.userId, dep.projectId)) continue;
      if (pipelines.some(pipe => pipe.userId === dep.userId && pipe.projectId === dep.projectId)) continue;
      const pipeline = await ensureGitPipeline(dep.userId, dep.name, cloneUrl, { projectId: dep.projectId, branch: dep.branch || branch });
      if (pipeline && pipeline.branch === branch) pipelines.push(pipeline);
    }

    // Trigger CI/CD Pipelines
    for (const pipe of pipelines) {
      if (!pipe.autoDeploy || pipe.branch !== branch) continue;

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
      if (dep.branch && dep.branch !== branch) continue;
      // A linked pipeline (including one with auto-deploy off) owns this update path.
      if (pipelines.some(pipe => pipe.userId === dep.userId && (dep.projectId ? pipe.projectId === dep.projectId : pipe.name.toLowerCase() === dep.name.toLowerCase()))) continue;
      if (dep.projectId && await readProjectSetup(dep.userId, dep.projectId)) continue;

      const safeBranch = (branch && isValidGitBranch(branch) ? branch : dep.branch) || "main";
      const stagingRoot = path.join(baseDeployDir, ".webhook-releases");
      fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
      const staging = fs.mkdtempSync(path.join(stagingRoot, "source-"));
      const targetDir = path.join(staging, "repo");
      try {
        await cloneGitSource(dep.userId, cloneUrl, safeBranch, targetDir);
      } catch {
        fs.rmSync(staging, { recursive: true, force: true });
        results.push({ deploymentId: dep.id, name: dep.name, status: "git_failed" });
        continue;
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
          projectId: dep.projectId || undefined,
          userId: dep.userId,
          name: dep.name,
          projectPath: targetDir,
          sourceType: "local",
          branch: safeBranch,
        }),
      }).then(async (response) => {
        const output = await response.text();
        const events = output.split("\n").filter(line => line.startsWith("data: ")).flatMap(line => {
          try { return [JSON.parse(line.slice(6))]; } catch { return []; }
        });
        if (!response.ok || !events.some(event => event.step === "complete" && event.status === "success")) {
          await prisma.rayDeployment.update({ where: { id: dep.id }, data: { status: "failed", buildLogs: output.slice(-100000) } });
        }
      }).catch(async () => {
        await prisma.rayDeployment.update({ where: { id: dep.id }, data: { status: "failed", buildLogs: "Automatic deployment failed. Review the Security reports and Brain logs." } }).catch(() => {});
      });

      results.push({ deploymentId: dep.id, name: dep.name, status: "redeploying" });
    }

    return NextResponse.json({ success: true, triggered: results });
  } catch (err: unknown) {
    console.error("Webhook processing error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

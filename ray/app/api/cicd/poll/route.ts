import { sameGitCommit } from "@/lib/git-commit";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import fs from "fs";
import { cloneGitSource } from "@/lib/git-source";

export const runtime = "nodejs";



// POST /api/cicd/poll — checks remote GitHub repos for new commits asynchronously without blocking
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Only poll pipelines for projects that are actively added to the local machine (RayMonitorProject)
    const monitorProjects = await prisma.rayMonitorProject.findMany({
      where: { userId: user.userId },
    });

    const localProjectMap = new Map<string, string>(); // lowerName -> projectPath
    for (const p of monitorProjects) {
      if (p.projectPath && fs.existsSync(p.projectPath)) {
        localProjectMap.set(p.name.toLowerCase(), p.projectPath);
      }
    }

    if (localProjectMap.size === 0) {
      return NextResponse.json({ message: "No local projects to poll", triggered: [] });
    }

    const pipelines = await prisma.rayPipeline.findMany({
      where: { userId: user.userId, autoDeploy: true },
      include: {
        runs: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    const validPipelines = pipelines.filter((pipe) => localProjectMap.has(pipe.name.toLowerCase()));
    if (validPipelines.length === 0) {
      return NextResponse.json({ message: "No active local pipelines", triggered: [] });
    }

    const triggered = [];

    for (const pipe of validPipelines) {
      const targetDir = localProjectMap.get(pipe.name.toLowerCase());
      if (!targetDir || !fs.existsSync(targetDir)) continue;

      try {
        const remote = await cloneGitSource(user.userId, pipe.repoUrl, pipe.branch || "main", "", true);
        const latestRemoteCommit = remote.commitHash.toLowerCase();
        const lastRunCommit = pipe.runs[0]?.commitHash;

        // If there's a new commit that hasn't been run yet, and no active run is already building:
        const isAlreadyRunning = pipe.runs[0]?.status === "running";
        if (latestRemoteCommit && !sameGitCommit(latestRemoteCommit, lastRunCommit) && latestRemoteCommit !== "push-tr" && !isAlreadyRunning) {
          const commitMsg = `New commit ${latestRemoteCommit} on ${pipe.branch}`;

          // Create PipelineRun
          const newRun = await prisma.$transaction(async tx => {
            const current = await tx.rayPipeline.findFirst({ where: { id: pipe.id, userId: user.userId, autoDeploy: true }, include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } } });
            if (!current || current.runs[0]?.status === "running" || sameGitCommit(latestRemoteCommit, current.runs[0]?.commitHash)) return null;
            const created = await tx.rayPipelineRun.create({
            data: {
              pipelineId: pipe.id,
              commitHash: latestRemoteCommit,
              commitMessage: commitMsg,
              author: "Git Auto-Sync",
              status: "running",
              stages: JSON.stringify([
                { name: "Git Clone & Sync", status: "running", durationMs: 0 },
                { name: "Dependencies", status: "pending", durationMs: 0 },
                { name: "Security Audit", status: "pending", durationMs: 0 },
                { name: "Docker Build", status: "pending", durationMs: 0 },
                { name: "Container Deploy", status: "pending", durationMs: 0 },
                { name: "Healthcheck", status: "pending", durationMs: 0 },
              ]),
              logs: `Detected new commit on ${pipe.repoUrl} (${pipe.branch})\nCommit: ${latestRemoteCommit}\n`,
            },
          });

          await tx.rayPipeline.update({
            where: { id: pipe.id },
            data: { status: "running", lastRunAt: new Date() },
          });

            return created;
          }, { isolationLevel: "Serializable" });
          if (!newRun) continue;

          // Trigger pipeline execution via unified runner
          const { executePipelineRun } = await import("@/lib/cicd-runner");
          executePipelineRun({
            pipelineId: pipe.id,
            runId: newRun.id,
            userId: user.userId,
            overrideAuthor: "Git Auto-Sync",
          }).catch((deployErr) => {
            console.error(`Poll auto-deploy error for ${pipe.name}:`, deployErr);
          });

          triggered.push({ pipelineId: pipe.id, name: pipe.name, commitHash: latestRemoteCommit });
        }
      } catch (pipeErr) {
        console.warn(`Could not poll git remote for ${pipe.name}:`, (pipeErr as Error).message);
      }
    }

    return NextResponse.json({ success: true, triggered });
  } catch (err) {
    console.error("POST /api/cicd/poll:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

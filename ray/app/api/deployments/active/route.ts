import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

// GET /api/deployments/active — returns any currently building or recently finished deployment/run
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const RECENT_SUCCESS_THRESHOLD_MS = 15 * 1000; // 15 seconds after completion
    const RECENT_FAILED_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours for failures

    // Helper to extract clean failure headline from buildLogs if failed
    const extractFailureReason = (logs?: string | null): string => {
      if (!logs) return "Build or application execution halted.";
      const lines = logs.trim().split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i].trim();
        if (l.includes("[DEPLOYMENT BLOCKED]") || l.includes("Critical danger-level")) {
          return "Blocked: Critical security vulnerabilities detected.";
        }
        if (l.includes("[ERROR]") || l.includes("Error:") || l.includes("error:") || l.includes("failed:")) {
          return l.replace(/^\[ERROR\]\s*/, "").slice(0, 140);
        }
      }
      return lines[lines.length - 1]?.slice(0, 140) || "Deployment halted with error.";
    };

    // Helper to parse stages from a PipelineRun
    const parseRunStages = (stagesJson?: string | null) => {
      let currentStage = "In Progress";
      let stageIndex = 1;
      let totalStages = 6;

      if (stagesJson) {
        try {
          const arr = JSON.parse(stagesJson);
          if (Array.isArray(arr) && arr.length > 0) {
            totalStages = arr.length;
            const runningIdx = arr.findIndex((s: any) => s.status === "running" || s.status === "building");
            if (runningIdx !== -1) {
              stageIndex = runningIdx + 1;
              currentStage = arr[runningIdx].name || "Building";
            } else {
              const dangerIdx = arr.findIndex((s: any) => s.status === "danger");
              if (dangerIdx !== -1) {
                stageIndex = dangerIdx + 1;
                currentStage = arr[dangerIdx].name || "Security Block";
              } else {
                const passedCount = arr.filter((s: any) => s.status === "success" || s.status === "overridden").length;
                stageIndex = Math.min(passedCount + 1, totalStages);
                currentStage = arr[Math.min(passedCount, totalStages - 1)]?.name || "Completed";
              }
            }
          }
        } catch { /* silent */ }
      }

      return { currentStage, stageIndex, totalStages };
    };

    // ── PRIORITY 1: Actively Running CI/CD Pipeline Run ──
    const activePipelineRun = await prisma.rayPipelineRun.findFirst({
      where: {
        pipeline: { userId: user.userId },
        OR: [
          { status: "running" },
          { status: "blocked_danger" },
        ],
      },
      include: { pipeline: true },
      orderBy: { createdAt: "desc" },
    });

    if (activePipelineRun) {
      const { currentStage, stageIndex, totalStages } = parseRunStages(activePipelineRun.stages);
      const isBlocked = activePipelineRun.status === "blocked_danger";

      return NextResponse.json({
        active: {
          id: activePipelineRun.id,
          pipelineId: activePipelineRun.pipelineId,
          type: "pipeline",
          name: activePipelineRun.pipeline.name,
          branch: activePipelineRun.pipeline.branch || "main",
          commitHash: activePipelineRun.commitHash,
          commitMessage: activePipelineRun.commitMessage,
          status: isBlocked ? "failed" : "building",
          failureReason: isBlocked ? "Blocked: Critical security vulnerabilities detected (Dual consent required)." : undefined,
          deployUrl: activePipelineRun.pipeline.port ? `http://localhost:${activePipelineRun.pipeline.port}` : undefined,
          port: activePipelineRun.pipeline.port,
          currentStage,
          stageIndex,
          totalStages,
          buildLogs: activePipelineRun.logs || "Executing CI/CD pipeline...",
          updatedAt: activePipelineRun.createdAt.getTime(),
        },
      });
    }

    // ── PRIORITY 2: Actively Building Deployment ──
    const activeDep = await prisma.rayDeployment.findFirst({
      where: {
        userId: user.userId,
        OR: [
          { status: "building" },
          { status: "deploying" },
          { status: "pending" },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });

    if (activeDep) {
      return NextResponse.json({
        active: {
          id: activeDep.id,
          projectId: activeDep.projectId,
          projectPath: activeDep.projectPath,
          type: "deployment",
          name: activeDep.name,
          branch: activeDep.branch || "main",
          commitHash: activeDep.commitHash,
          commitMessage: activeDep.commitMessage,
          status: "building",
          deployUrl: activeDep.deployUrl,
          port: activeDep.hostPort,
          currentStage: activeDep.containerName?.startsWith("process:") ? "Host Build & Process Start" : "Docker Build & Container Deploy",
          stageIndex: 4,
          totalStages: 6,
          buildLogs: activeDep.buildLogs || "Building application...",
          updatedAt: activeDep.updatedAt.getTime(),
        },
      });
    }

    // ── PRIORITY 3: Recently Completed or Failed Run (only if nothing is active) ──
    const recentRun = await prisma.rayPipelineRun.findFirst({
      where: {
        pipeline: { userId: user.userId },
        OR: [
          {
            status: "success",
            createdAt: { gte: new Date(Date.now() - RECENT_SUCCESS_THRESHOLD_MS) },
          },
          {
            status: "failed",
            createdAt: { gte: new Date(Date.now() - RECENT_FAILED_THRESHOLD_MS) },
          },
        ],
      },
      include: { pipeline: true },
      orderBy: { createdAt: "desc" },
    });

    if (recentRun) {
      const { currentStage, stageIndex, totalStages } = parseRunStages(recentRun.stages);
      const isSuccess = recentRun.status === "success";

      return NextResponse.json({
        active: {
          id: recentRun.id,
          pipelineId: recentRun.pipelineId,
          type: "pipeline",
          name: recentRun.pipeline.name,
          branch: recentRun.pipeline.branch || "main",
          commitHash: recentRun.commitHash,
          commitMessage: recentRun.commitMessage,
          status: isSuccess ? "healthy" : "failed",
          failureReason: !isSuccess ? extractFailureReason(recentRun.logs) : undefined,
          deployUrl: recentRun.pipeline.port ? `http://localhost:${recentRun.pipeline.port}` : undefined,
          port: recentRun.pipeline.port,
          currentStage: isSuccess ? "Completed" : currentStage,
          stageIndex: isSuccess ? totalStages : stageIndex,
          totalStages,
          buildLogs: recentRun.logs || (isSuccess ? "Pipeline completed successfully." : "Pipeline failed."),
          updatedAt: recentRun.createdAt.getTime(),
        },
      });
    }

    // ── PRIORITY 4: Recently Completed or Failed Deployment (only if nothing is active) ──
    const recentDep = await prisma.rayDeployment.findFirst({
      where: {
        userId: user.userId,
        OR: [
          {
            status: "healthy",
            updatedAt: { gte: new Date(Date.now() - RECENT_SUCCESS_THRESHOLD_MS) },
          },
          {
            status: "failed",
            updatedAt: { gte: new Date(Date.now() - RECENT_FAILED_THRESHOLD_MS) },
          },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });

    if (recentDep) {
      const isSuccess = recentDep.status === "healthy";
      return NextResponse.json({
        active: {
          id: recentDep.id,
          projectId: recentDep.projectId,
          projectPath: recentDep.projectPath,
          type: "deployment",
          name: recentDep.name,
          branch: recentDep.branch || "main",
          commitHash: recentDep.commitHash,
          commitMessage: recentDep.commitMessage,
          status: isSuccess ? "healthy" : "failed",
          failureReason: !isSuccess ? extractFailureReason(recentDep.buildLogs) : undefined,
          deployUrl: recentDep.deployUrl,
          port: recentDep.hostPort,
          currentStage: isSuccess ? "Completed" : "Build Failed",
          stageIndex: isSuccess ? 6 : 4,
          totalStages: 6,
          buildLogs: recentDep.buildLogs || (isSuccess ? "Deployment healthy." : "Deployment failed."),
          updatedAt: recentDep.updatedAt.getTime(),
        },
      });
    }

    return NextResponse.json({ active: null });
  } catch (err) {
    console.error("GET /api/deployments/active:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

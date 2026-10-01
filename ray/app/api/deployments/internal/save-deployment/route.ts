import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * POST /api/deployments/internal/save-deployment
 *
 * Internal Brain → Ray endpoint to persist/update a deployment record in MySQL DB.
 * Requires x-brain-secret header matching BRAIN_INTERNAL_SECRET env var.
 */
export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-brain-secret");
    const expected = process.env.BRAIN_INTERNAL_SECRET;
    const secretBuffer = secret ? Buffer.from(secret) : null;
    const expectedBuffer = expected ? Buffer.from(expected) : null;
    const validSecret =
      secretBuffer &&
      expectedBuffer &&
      secretBuffer.length === expectedBuffer.length &&
      timingSafeEqual(secretBuffer, expectedBuffer);
    if (!validSecret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    let {
      id: depId,
      userId,
      projectId,
      name,
      projectPath,
      containerName,
      containerId,
      imageName,
      hostPort,
      containerPort = 3000,
      deployUrl,
      status = "healthy",
      buildLogs = "",
      sourceType = "local",
      repoUrl,
      branch,
      commitHash,
      commitMessage,
    } = body;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    if (!userId) {
      const firstUser = await prisma.user.findFirst({ select: { id: true } });
      if (firstUser) {
        userId = firstUser.id;
      } else {
        return NextResponse.json({ error: "No user found in database" }, { status: 400 });
      }
    }

    // Ensure matching RayMonitorProject exists or auto-create it
    if (!projectId) {
      let matchingProject = await prisma.rayMonitorProject.findFirst({
        where: {
          userId,
          OR: [
            { name: name.trim() },
            { name: name.toLowerCase().trim() },
            ...(projectPath ? [{ projectPath: projectPath.trim() }] : []),
          ],
        },
      });

      if (!matchingProject) {
        try {
          matchingProject = await prisma.rayMonitorProject.create({
            data: {
              userId,
              name: name.trim(),
              projectPath: projectPath || `/deployments/${name.trim()}`,
              logPaths: "[]",
              projectUrl: deployUrl || (hostPort ? `http://localhost:${hostPort}` : null),
              status: status === "healthy" ? "running" : status || "running",
              enabled: true,
              intervalSec: 30,
            },
          });
        } catch { /* if created concurrently */ }
      } else if (deployUrl && !matchingProject.projectUrl) {
        await prisma.rayMonitorProject.update({
          where: { id: matchingProject.id },
          data: {
            projectUrl: deployUrl,
            status: status === "healthy" ? "running" : status,
          },
        }).catch(() => {});
      }

      if (matchingProject) {
        projectId = matchingProject.id;
      }
    }

    // Find existing deployment record to update or create new one
    const cleanName = name.trim();
    const existingDep = await prisma.rayDeployment.findFirst({
      where: {
        userId,
        OR: [
          ...(depId ? [{ id: depId }] : []),
          ...(projectId ? [{ projectId }] : []),
          { name: cleanName },
          { containerName: containerName || `ray-${cleanName.toLowerCase()}` },
        ],
      },
    });

    let savedDeployment;
    if (existingDep) {
      savedDeployment = await prisma.rayDeployment.update({
        where: { id: existingDep.id },
        data: {
          projectId: projectId || existingDep.projectId,
          containerName: containerName || existingDep.containerName || `ray-${cleanName.toLowerCase()}`,
          containerId: containerId || existingDep.containerId,
          imageName: imageName || existingDep.imageName,
          hostPort: hostPort !== undefined ? Number(hostPort) : existingDep.hostPort,
          containerPort: containerPort !== undefined ? Number(containerPort) : existingDep.containerPort,
          deployUrl: deployUrl || existingDep.deployUrl,
          status,
          buildLogs: buildLogs || existingDep.buildLogs,
          projectPath: projectPath || existingDep.projectPath,
          ...(repoUrl ? { repoUrl } : {}),
          ...(branch ? { branch } : {}),
          ...(commitHash ? { commitHash } : {}),
          ...(commitMessage ? { commitMessage } : {}),
          updatedAt: new Date(),
        },
      });
    } else {
      savedDeployment = await prisma.rayDeployment.create({
        data: {
          ...(depId ? { id: depId } : {}),
          userId,
          projectId: projectId || null,
          name: cleanName,
          sourceType,
          projectPath: projectPath || `/deployments/${cleanName}`,
          containerName: containerName || `ray-${cleanName.toLowerCase()}`,
          containerId: containerId || null,
          imageName: imageName || `${cleanName}:latest`,
          hostPort: hostPort !== undefined ? Number(hostPort) : null,
          containerPort: Number(containerPort) || 3000,
          deployUrl: deployUrl || null,
          repoUrl: repoUrl || null,
          branch: branch || "main",
          commitHash: commitHash || null,
          commitMessage: commitMessage || null,
          status,
          buildLogs,
        },
      });
    }

    // Also link to CI/CD pipeline if it's a Git repository
    if (projectPath) {
      const { ensureGitPipeline } = await import("@/lib/cicd-sync");
      await ensureGitPipeline(userId, cleanName, projectPath, {
        projectId: projectId || savedDeployment.id,
        port: hostPort || 3000,
      }).catch(() => {});
    }

    return NextResponse.json({ deployment: savedDeployment }, { status: 200 });
  } catch (err) {
    console.error("POST /api/deployments/internal/save-deployment:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

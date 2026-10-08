import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * POST /api/monitor/internal/add-project
 *
 * Internal Brain → Ray endpoint for persisting a monitored project to the DB.
 * Requires X-Brain-Secret header matching BRAIN_INTERNAL_SECRET env var.
 */
export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-brain-secret");
    const expected = process.env.BRAIN_INTERNAL_SECRET;
    if (!expected || secret !== expected) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    let { userId, name, projectPath, logPaths = [], logCommand, intervalSec = 30, status = "discovering" } = body;

    if (!name || !projectPath) {
      return NextResponse.json({ error: "name and projectPath are required" }, { status: 400 });
    }

    if (!userId) {
      const firstUser = await prisma.user.findFirst({ select: { id: true } });
      if (firstUser) {
        userId = firstUser.id;
      } else {
        return NextResponse.json({ error: "No user found in database" }, { status: 400 });
      }
    }

    // Upsert — prevent duplicates if brain restarts and re-adds
    const existing = await prisma.rayMonitorProject.findFirst({
      where: {
        userId,
        ...(body.id ? { id: body.id } : { OR: [{ projectPath }, { name: name.trim() }] }),
      },
    });

    if (existing) {
      const updated = await prisma.rayMonitorProject.update({
        where: { id: existing.id },
        data: {
          name: name.trim(),
          projectPath,
          logPaths: JSON.stringify(logPaths),
          logCommand: body.managedLogFile || logPaths.some((value: string) => value.startsWith("docker:")) ? null : logCommand || existing.logCommand,
          ...(body.managedLogFile ? { managedPid: body.managedPid || null, managedLogFile: body.managedLogFile, runCommand: body.runCommand || null } : logPaths.some((value: string) => value.startsWith("docker:")) ? { managedPid: null, managedLogFile: null } : {}),
          intervalSec,
          status,
          enabled: true,
          updatedAt: new Date(),
        },
      });

      // Auto-create CI/CD pipeline if project is a Git repository
      const { ensureGitPipeline } = await import("@/lib/cicd-sync");
      await ensureGitPipeline(userId, updated.name, updated.projectPath, {
        projectId: updated.id,
      }).catch(() => {});

      return NextResponse.json({ project: updated, created: false }, { status: 200 });
    }

    const project = await prisma.rayMonitorProject.create({
      data: {
        userId,
        ...(body.id ? { id: body.id } : {}),
        ...(body.managedLogFile ? { managedPid: body.managedPid || null, managedLogFile: body.managedLogFile, runCommand: body.runCommand || null } : logPaths.some((value: string) => value.startsWith("docker:")) ? { managedPid: null, managedLogFile: null } : {}),
        name: name.trim(),
        projectPath,
        logPaths: JSON.stringify(logPaths),
        logCommand: logCommand || null,
        intervalSec,
        enabled: true,
        status,
      },
    });

    // Auto-create CI/CD pipeline if project is a Git repository
    const { ensureGitPipeline } = await import("@/lib/cicd-sync");
    await ensureGitPipeline(userId, project.name, project.projectPath, {
      projectId: project.id,
    }).catch(() => {});

    return NextResponse.json({ project, created: true }, { status: 201 });
  } catch (err) {
    console.error("POST /api/monitor/internal/add-project:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { hostRuntimeHandle } from "@/lib/host-runtime";

export const maxDuration = 480;

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";
const BRAIN_INTERNAL_SECRET = process.env.BRAIN_INTERNAL_SECRET || "";

// GET /api/monitor/projects/[id]/run  — detect if a process is already running
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const project = await prisma.rayMonitorProject.findFirst({
      where: { id, userId: user.userId },
      select: { id: true, name: true, projectPath: true, runCommand: true, managedPid: true, managedLogFile: true },
    });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (project.managedLogFile && /application-[a-f0-9]+\.log$/.test(project.managedLogFile)) {
      const deployment = await prisma.rayDeployment.findFirst({ where: { projectId: id, userId: user.userId, containerName: hostRuntimeHandle(user.userId, id) }, orderBy: { updatedAt: "desc" } });
      return NextResponse.json({
        processes: project.managedPid ? [{ pid: project.managedPid, command: project.runCommand || "", runtime: "host", logFile: project.managedLogFile, port: deployment?.hostPort, url: deployment?.deployUrl }] : [],
        suggestedCommand: project.runCommand || "", managedPid: project.managedPid, managedLogFile: project.managedLogFile,
        managedPort: deployment?.hostPort, managedUrl: deployment?.deployUrl, container: null, runtime: "host",
      });
    }

    // Ask Brain to detect running processes
    interface RunningProc {
      pid: number;
      command: string;
      runtime: string;
      logFile: string;
      port?: number;
      url?: string;
    }
    let processes: RunningProc[] = [];
    let suggestedCommand = project.runCommand || "";
    let managedPort: number | null = null;
    let managedUrl: string | null = null;
    let container: any = null;

    try {
      const res = await fetch(
        `${BRAIN_URL}/v1/monitor/process/detect?path=${encodeURIComponent(project.projectPath)}&id=${encodeURIComponent(id)}&name=${encodeURIComponent(project.name)}`,
        { headers: { "x-internal-secret": BRAIN_INTERNAL_SECRET }, signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const data = await res.json();
        processes = (data.processes || []) as RunningProc[];
        if (!suggestedCommand) suggestedCommand = data.suggestedCommand || "";
        if (data.managedPort) managedPort = data.managedPort;
        if (data.managedUrl) managedUrl = data.managedUrl;
        if (data.container) container = data.container;
      }
    } catch {
      // Brain offline — return what we know from DB
    }

    // If managedPort was not directly returned, check if any running process has a port
    if (!managedPort && processes.length > 0) {
      const foundWithPort = processes.find((p) => p.port && p.port > 0);
      if (foundWithPort?.port) {
        managedPort = foundWithPort.port;
        managedUrl = foundWithPort.url || `http://localhost:${foundWithPort.port}`;
      }
    }

    return NextResponse.json({
      processes,
      suggestedCommand,
      managedPid: project.managedPid,
      managedLogFile: project.managedLogFile,
      managedPort,
      managedUrl,
      container,
    });
  } catch (err) {
    console.error("GET /api/monitor/projects/[id]/run:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/monitor/projects/[id]/run  — spawn or stop the project process
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const project = await prisma.rayMonitorProject.findFirst({
      where: { id, userId: user.userId },
      select: { id: true, projectPath: true, runCommand: true, managedLogFile: true },
    });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const { action, command, killPid, containerName } = body as { action: "spawn" | "stop" | "restart-container"; command?: string; killPid?: number; containerName?: string };

    if (project.managedLogFile && /application-[a-f0-9]+\.log$/.test(project.managedLogFile)) {
      if (!["stop", "spawn", "restart-container"].includes(action)) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
      if (action === "spawn" && command && command !== project.runCommand) return NextResponse.json({ error: "Change the start command in Deployment setup, then rebuild." }, { status: 400 });
      const response = await fetch(`${BRAIN_URL}/v1/deploy/action`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-brain-secret": BRAIN_INTERNAL_SECRET },
        body: JSON.stringify({ action: action === "stop" ? "stop" : "restart", container: hostRuntimeHandle(user.userId, id) }),
        signal: AbortSignal.timeout(450000),
      });
      if (!response.ok) return NextResponse.json({ error: await response.text() }, { status: 502 });
      const updated = await prisma.rayMonitorProject.findUnique({ where: { id } });
      return NextResponse.json({ ok: true, action: action === "stop" ? "stopped" : "restarted", pid: updated?.managedPid, logFile: updated?.managedLogFile, command: updated?.runCommand });
    }

    if (containerName && (action === "stop" || action === "restart-container")) {
      const linked = await prisma.rayDeployment.findFirst({ where: { userId: user.userId, projectId: id, OR: [{ containerName }, { containerId: containerName }] } });
      if (!linked?.containerName) return NextResponse.json({ error: "This container is not linked to this project's deployment." }, { status: 403 });
      try {
        const response = await fetch(`${BRAIN_URL}/v1/containers/${encodeURIComponent(linked.containerName)}/${action === "stop" ? "stop" : "restart"}`, {
          method: "POST", headers: { "x-brain-secret": BRAIN_INTERNAL_SECRET }, signal: AbortSignal.timeout(45000),
        });
        if (!response.ok) return NextResponse.json({ error: "Container action or route cleanup failed. Check Brain and Caddy." }, { status: 502 });
        if (action === "stop") await prisma.rayDeployment.update({ where: { id: linked.id }, data: { status: "stopped" } });
      } catch { return NextResponse.json({ error: "Container control is unavailable." }, { status: 502 }); }
      if (action === "restart-container") return NextResponse.json({ ok: true, action: "restarted" });
    }
    if (action === "stop") {

      // Tell Brain to stop
      try {
        await fetch(`${BRAIN_URL}/v1/monitor/process/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": BRAIN_INTERNAL_SECRET },
          body: JSON.stringify({ projectId: id, pid: killPid }),
          signal: AbortSignal.timeout(5000),
        });
      } catch { /* Brain offline */ }

      await prisma.rayMonitorProject.update({
        where: { id },
        data: { managedPid: null, managedLogFile: null, updatedAt: new Date() },
      });
      return NextResponse.json({ ok: true, action: "stopped" });
    }

    if (action === "restart-container") return NextResponse.json({ error: "Choose a linked container." }, { status: 400 });

    // action === "spawn"
    const cmd = command || project.runCommand || "npm run dev";
    const res = await fetch(`${BRAIN_URL}/v1/monitor/process/spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": BRAIN_INTERNAL_SECRET },
      body: JSON.stringify({ projectId: id, projectPath: project.projectPath, command: cmd, killPid: killPid || 0 }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    const data = await res.json();
    const { pid, logFile, port, url } = data as { pid: number; logFile: string; command: string; port?: number; url?: string };

    // Persist managed process info to DB
    await prisma.rayMonitorProject.update({
      where: { id },
      data: {
        managedPid: pid,
        managedLogFile: logFile,
        runCommand: cmd,
        // Add the log file to logCommand so monitoring can read it
        logCommand: `tail -n 300 ${logFile}`,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ pid, logFile, command: cmd, port, url });
  } catch (err) {
    console.error("POST /api/monitor/projects/[id]/run:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

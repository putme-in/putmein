import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";
const BRAIN_INTERNAL_SECRET = process.env.BRAIN_INTERNAL_SECRET || "";

export const runtime = "nodejs";

function fallbackDiagnosisFromLogs(logs: string) {
  if (!logs) return null;
  const lower = logs.toLowerCase();

  // 0. Package Manifest Syntax Errors (EJSONPARSE / JSON.parse)
  if (
    lower.includes("ejsonparse") ||
    lower.includes("expected ',' or '}'") ||
    (lower.includes("json.parse") && (lower.includes("package.json") || lower.includes("expected"))) ||
    (lower.includes("unexpected token") && lower.includes("package.json")) ||
    (lower.includes("failed to parse") && lower.includes("package.json"))
  ) {
    return {
      summary: "Package Manifest Syntax Error: package.json contains invalid JSON.",
      rootCause:
        "The build failed with an EJSONPARSE error because package.json contains invalid JSON syntax (such as a missing comma between properties, trailing comma, or misplaced syntax). Package managers cannot parse an invalid manifest, preventing dependencies from installing and halting the build.",
      fixSteps: [
        "Open package.json and locate the syntax error (check for missing commas between properties or trailing commas)",
        "Validate package.json syntax using a JSON validator or 'node -e \"JSON.parse(require('fs').readFileSync('package.json'))\"'",
        "Commit and push the valid package.json, then retry the deployment",
      ],
      commands: [],
      startCommand: "npm install",
      canAutoFix: false,
    };
  }

  // 1. Docker daemon & Named-Pipe Connectivity Errors (Windows / Linux / macOS)
  if (
    lower.includes("pipe/docker_engine") ||
    lower.includes("dockerdesktoplinuxengine") ||
    lower.includes("cannot connect to the docker daemon") ||
    lower.includes("is the docker daemon running") ||
    lower.includes("open //./pipe/docker_engine") ||
    (lower.includes("error during connect") && (lower.includes("docker") || lower.includes("pipe") || lower.includes("daemon")))
  ) {
    return {
      summary: "Docker Engine Connection Failed: Unable to reach Docker daemon.",
      rootCause:
        "PutmeIn was unable to connect to the Docker daemon. On Windows, Docker Desktop may not be running, WSL 2 backend may be stopped, or the named pipe (npipe:////./pipe/docker_engine) is unavailable. On Linux/macOS, the Docker socket (/var/run/docker.sock) is unreachable.",
      fixSteps: [
        "Start Docker Desktop (or run 'sudo systemctl start docker' on Linux)",
        "On Windows: Verify Docker Desktop settings have WSL 2 enabled and engine running",
        "Ensure your user account belongs to the 'docker-users' (Windows) or 'docker' (Linux) group",
        "Once Docker is running, click 'Retry Diagnosis' or redeploy the project",
      ],
      commands: [],
      startCommand: "docker info",
      canAutoFix: false,
    };
  }

  // 2. Dockerfile Build & Syntax Errors
  if (
    lower.includes("dockerfile parse error") ||
    lower.includes("failed to solve with frontend dockerfile") ||
    (lower.includes("docker build") && lower.includes("error:"))
  ) {
    return {
      summary: "Docker Build Failed: Error occurred while building container image.",
      rootCause: "The container image build encountered a syntax error or a failing command step in the Dockerfile.",
      fixSteps: [
        "Inspect the Dockerfile instructions and verify syntax",
        "Verify all files referenced in COPY/ADD commands exist in the repository",
        "Test building the image locally using 'docker build .'",
      ],
      commands: [],
      startCommand: "docker build .",
      canAutoFix: false,
    };
  }

  return null;
}

// POST /api/deployments/[id]/diagnose — AI troubleshooter analyzes why a deployment or container failed
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  let logs = "";
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;

    // Find matching deployment
    let deployment = await prisma.rayDeployment.findFirst({
      where: { id, userId: user.userId },
    });

    if (!deployment) {
      // Fallback: check if id is a monitor project with linked deployment
      deployment = await prisma.rayDeployment.findFirst({
        where: {
          userId: user.userId,
          OR: [{ projectId: id }, { name: id }, { containerName: `ray-${id.toLowerCase()}` }],
        },
        orderBy: { createdAt: "desc" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const modelId = body.modelId || cookieStore.get("ray_selected_model")?.value || "";
    logs = body.logs || deployment?.buildLogs || "";

    if (!deployment && !logs) {
      return NextResponse.json({ error: "Deployment or logs not found" }, { status: 404 });
    }

    // If container exists, also attempt to fetch runtime crash logs
    if (deployment?.containerName) {
      try {
        const cLogsRes = await fetch(
          `${BRAIN_URL}/v1/deploy/logs?container=${encodeURIComponent(deployment.containerName)}&lines=80`,
          { headers: { "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" }, signal: AbortSignal.timeout(2000) }
        );
        if (cLogsRes.ok) {
          const cLogsData = await cLogsRes.json();
          if (cLogsData.logs && cLogsData.logs.trim()) {
            logs += `\n\n--- Container Runtime Logs (${deployment.containerName}) ---\n${cLogsData.logs}`;
          }
        }
      } catch { /* non-blocking */ }
    }

    // A security gate has a structured report; do not ask a model to guess or bypass it.
    const scanId = logs.match(/\bscan_\d+\b/)?.[0];
    if (scanId && /security.*(?:blocked|incomplete)|(?:blocked|incomplete).*security/i.test(logs)) {
      const scan = await prisma.raySecurityScan.findFirst({ where: { id: scanId, userId: user.userId } });
      const findings: { title?: string; file?: string; line?: number; severity?: string }[] = scan ? JSON.parse(scan.findings || "[]") : [];
      return NextResponse.json({ diagnosis: {
        summary: scan ? `Deployment blocked by security checks: ${scan.dangerCount} danger findings, ${scan.warnCount} warnings` : "Deployment blocked by security checks",
        rootCause: "The deployment stopped at a security checkpoint. Retrying unchanged source will encounter the same check. Pattern matches require review; they are not proof of exploitable vulnerabilities.",
        fixSteps: [
          ...findings.filter(f => f.severity === "danger").slice(0, 12).map(f => `${f.title || "Security finding"} — ${f.file || "source"}${f.line ? `:${f.line}` : ""}`),
          "Open the security report and review each finding, including examples that may be false positives.",
          "Fix confirmed issues before retrying. This troubleshooter does not change source or approve security exceptions.",
        ], commands: [], canAutoFix: false, securityScanId: scanId,
      } });
    }

    // Call Brain's AI Diagnostic engine
    const targetId = deployment?.projectId || deployment?.id || id || "default";
    const projectPath = deployment?.projectPath || body.projectPath || "";
    const res = await fetch(`${BRAIN_URL}/v1/monitor/projects/${targetId}/diagnose`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": BRAIN_INTERNAL_SECRET,
      },
      body: JSON.stringify({
        modelId,
        projectPath,
        command: "docker build & deploy",
        logs,
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      // If Brain fails, check if logs contain an unambiguous recognizable issue like Docker connection failure
      const fallback = fallbackDiagnosisFromLogs(logs);
      if (fallback) {
        return NextResponse.json({ diagnosis: fallback });
      }

      let errorMessage = "AI diagnosis failed";
      try {
        const errData = await res.json();
        errorMessage = errData.error || errData.message || errorMessage;
      } catch {
        const text = await res.text().catch(() => "");
        if (text && text.trim()) {
          errorMessage = text.trim();
        }
      }
      return NextResponse.json(
        { error: `AI request failed: ${errorMessage.replace(/^diagnosis failed:\s*/i, "")}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    console.error("POST /api/deployments/[id]/diagnose:", err);
    const fallback = fallbackDiagnosisFromLogs(logs);
    if (fallback) {
      return NextResponse.json({ diagnosis: fallback });
    }
    return NextResponse.json(
      { error: err instanceof Error ? `AI request failed: ${err.message}` : "Internal diagnosis error" },
      { status: 500 }
    );
  }
}

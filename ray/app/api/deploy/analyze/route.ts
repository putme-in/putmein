import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import fs from "fs";
import { resolveProjectSource } from "@/lib/project-source";
import { detectFramework } from "@/lib/framework-detection";
import { FRAMEWORKS } from "@/lib/framework-registry";
import path from "path";
import { verifyToken } from "@/lib/auth";
import { detectProjectStack } from "@/lib/project-detector";
import { getFullPortRegistry } from "@/lib/port-manager";

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    let source: ReturnType<typeof resolveProjectSource>;
    try {
      source = resolveProjectSource(body.sourceRoot || body.projectPath, body.appDirectory ?? ".");
    } catch {
      return NextResponse.json({ error: "Choose an existing application directory inside the source directory." }, { status: 400 });
    }
    const { projectPath } = source;

    const detected = detectProjectStack(projectPath);
    const dockerfilePath = path.join(projectPath, "Dockerfile");
    let hasDockerfile = false;
    try { hasDockerfile = fs.lstatSync(dockerfilePath).isFile(); } catch { /* no Dockerfile */ }
    let dockerfileContent: string | null = null;
    if (hasDockerfile) {
      try {
        // Source review must not follow repository symlinks or read unbounded files.
        if (fs.statSync(dockerfilePath).size <= 1024 * 1024) {
          dockerfileContent = fs.readFileSync(dockerfilePath, "utf-8");
        }
      } catch {
        // ignore
      }
    }

    // Inspect files summary (top-level files)
    let filesSummary: string[] = [];
    try {
      filesSummary = fs
        .readdirSync(projectPath)
        .filter((f) => !f.startsWith(".") && f !== "node_modules" && f !== ".git")
        .slice(0, 15);
    } catch {
      // ignore
    }

    // Find next available port
    let suggestedPort = 4050;
    try {
      const portRegistry = await getFullPortRegistry(user.userId);
      if (portRegistry.nextFreePort) {
        suggestedPort = portRegistry.nextFreePort;
      } else if (portRegistry.suggestedPorts && portRegistry.suggestedPorts.length > 0) {
        suggestedPort = portRegistry.suggestedPorts[0];
      }
    } catch (e) {
      console.warn("Could not determine next free port:", e);
    }

    const definition = detectFramework(projectPath);
    const containerPort = definition?.port || 3000;

    return NextResponse.json({
      success: true,
      framework: detected.framework,
      frameworkSlug: detected.frameworkSlug,
      language: detected.language,
      icon: detected.icon,
      colorClasses: detected.colorClasses,
      hasDockerfile,
      dockerfileContent,
      containerPort,
      startCommand: definition?.startCommand || "",
      isMonorepo: definition?.isMonorepo || false,
      frameworks: FRAMEWORKS,
      suggestedPort,
      ...source,
      filesSummary,
    });
  } catch (err: unknown) {
    console.error("Analyze error:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Failed to analyze codebase" },
      { status: 500 }
    );
  }
}

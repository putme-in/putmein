import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { normalizeDomain, parseProjectDomains } from "@/lib/domains";

export const runtime = "nodejs";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

// Fast in-memory cache for resolved domain upstreams
interface CachedResolution {
  found: boolean;
  projectId?: string;
  projectName?: string;
  port?: number;
  upstream?: string;
  timestamp: number;
}

const resolutionCache = new Map<string, CachedResolution>();
const CACHE_TTL_MS = 10_000; // 10 seconds

export async function GET(req: NextRequest) {
  try {
    const rawHost = req.nextUrl.searchParams.get("host") || "";
    const cleanHost = normalizeDomain(rawHost);

    if (!cleanHost) {
      return NextResponse.json({ found: false, error: "Missing host parameter" }, { status: 400 });
    }

    // Check cache
    const now = Date.now();
    const cached = resolutionCache.get(cleanHost);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(cached);
    }

    // 1. Fetch all monitor projects with their projectUrls
    const projects = await prisma.rayMonitorProject.findMany({
      select: {
        id: true,
        userId: true,
        name: true,
        projectUrl: true,
        status: true,
        managedPid: true,
      },
    });

    let matchedProject: (typeof projects)[0] | null = null;
    for (const p of projects) {
      const domains = parseProjectDomains(p.projectUrl);
      const hostnames = domains.map(normalizeDomain);
      if (hostnames.includes(cleanHost)) {
        if (matchedProject) return NextResponse.json({ found: false, error: "Domain assignment is ambiguous" }, { status: 409 });
        matchedProject = p;
      }
    }

    if (!matchedProject) {
      const notFoundResult: CachedResolution = { found: false, timestamp: now };
      resolutionCache.set(cleanHost, notFoundResult);
      return NextResponse.json(notFoundResult);
    }

    // 2. Resolve target upstream port
    let targetPort: number | null = null;

    const deployment = await prisma.rayDeployment.findFirst({
      where: { userId: matchedProject.userId, projectId: matchedProject.id, status: "healthy" },
      orderBy: { updatedAt: "desc" }, select: { hostPort: true },
    });
    targetPort = deployment?.hostPort || null;

    const result: CachedResolution = {
      found: true,
      projectId: matchedProject.id,
      projectName: matchedProject.name,
      port: targetPort || undefined,
      upstream: targetPort ? `http://127.0.0.1:${targetPort}` : undefined,
      timestamp: now,
    };

    resolutionCache.set(cleanHost, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/domains/resolve error:", err);
    return NextResponse.json({ found: false, error: "Internal error" }, { status: 500 });
  }
}

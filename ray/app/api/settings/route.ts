import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getDefaultDeploymentsDir, getDeploymentsDir } from "@/lib/settings";
import { detectServerIp } from "@/lib/network";
import os from "os";

export const runtime = "nodejs";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

// GET /api/settings — returns current agent, routing, and deployment settings
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const forceRefresh = req.nextUrl?.searchParams?.get("refresh") === "1";
    const network = await detectServerIp(forceRefresh);

    let autonomous = false;
    let securityChecksEnabled = true;
    let routingMode = network.isPubliclyExposed ? "domain" : "port";
    let domainProvider = "sslip";
    let customRootDomain = "";
    let executionMode = "plan";
    let deploymentsPath = await getDeploymentsDir();
    const defaultDeploymentsPath = getDefaultDeploymentsDir();
    let apiKeys: Record<string, boolean> = {
      ozias: false,
      minimax: false,
      claude: false,
      openai: false,
      deepseek: false,
      gemini: false,
      openrouter: false,
    };

    try {
      const res = await fetch(`${BRAIN_URL}/v1/settings`, { headers: { "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" }, signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data = await res.json();
        autonomous = data.autonomous ?? false;
        if (typeof data.securityChecksEnabled === "boolean") {
          securityChecksEnabled = data.securityChecksEnabled;
        }
        if (data.routingMode) routingMode = data.routingMode;
        if (data.domainProvider) domainProvider = data.domainProvider;
        if (data.customRootDomain !== undefined) customRootDomain = data.customRootDomain;
        if (data.executionMode) executionMode = data.executionMode;
        if (data.deploymentsPath) deploymentsPath = data.deploymentsPath;
        if (data.apiKeys) apiKeys = data.apiKeys;
      }
    } catch {
      // Use resolved fallback
    }

    return NextResponse.json({
      autonomous,
      securityChecksEnabled,
      routingMode,
      domainProvider,
      customRootDomain,
      executionMode,
      network,
      deploymentsPath,
      defaultDeploymentsPath,
      platform: os.platform(),
      apiKeys,
    });
  } catch (err) {
    console.error("GET /api/settings error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// POST /api/settings — updates agent and deployment directory settings
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    if (body.securityChecksEnabled !== undefined) {
      if (typeof body.securityChecksEnabled !== "boolean") return NextResponse.json({ error: "Security policy must be true or false." }, { status: 400 });
      if (user.role?.toLowerCase() !== "admin") return NextResponse.json({ error: "Only an administrator can change the server-wide security gate." }, { status: 403 });
    }

    const res = await fetch(`${BRAIN_URL}/v1/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Failed to update settings in Brain" }, { status: 502 });
  } catch (err) {
    console.error("POST /api/settings error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

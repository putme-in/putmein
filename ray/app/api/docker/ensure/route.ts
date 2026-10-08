import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exec } from "child_process";
import { promisify } from "util";
import { verifyToken } from "@/lib/auth";

const execAsync = promisify(exec);

async function checkDocker(): Promise<boolean> {
  try {
    await execAsync("docker info", { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    const isRunning = await checkDocker();
    return NextResponse.json({ running: isRunning });
  } catch (err: unknown) {
    return NextResponse.json({ running: false, error: (err as Error).message });
  }
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const alreadyRunning = await checkDocker();
    if (alreadyRunning) {
      return NextResponse.json({ running: true, started: false });
    }

    // Try spinning up Docker daemon based on OS platform
    const platform = process.platform;
    if (platform === "darwin") {
      try {
        await execAsync("open -a Docker || open -a /Applications/Docker.app");
      } catch (e) {
        console.warn("Could not launch Docker.app:", e);
      }
    } else if (platform === "linux") {
      try {
        await execAsync("systemctl start docker || service docker start");
      } catch (e) {
        console.warn("Could not run systemctl start docker:", e);
      }
    } else if (platform === "win32") {
      try {
        await execAsync('start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"');
      } catch (e) {
        console.warn("Could not start Docker Desktop on Windows:", e);
      }
    }

    // Poll until Docker is ready (up to 30 seconds)
    const startTime = Date.now();
    let isReady = false;
    while (Date.now() - startTime < 30000) {
      await new Promise((r) => setTimeout(r, 1500));
      isReady = await checkDocker();
      if (isReady) break;
    }

    if (isReady) {
      return NextResponse.json({ running: true, started: true });
    }

    return NextResponse.json({
      running: false,
      error: "Docker is not running and could not be started automatically. Please launch Docker Desktop manually.",
    });
  } catch (err: unknown) {
    console.error("Docker ensure error:", err);
    return NextResponse.json(
      { running: false, error: (err as Error).message || "Failed to inspect Docker daemon" },
      { status: 500 }
    );
  }
}

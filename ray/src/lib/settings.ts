import os from "os";
import path from "path";
import fs from "fs";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

/**
 * Returns the default OS-dependent deployments directory.
 * macOS/Linux: ~/.ray/deployments
 * Windows: %USERPROFILE%\.ray\deployments
 */
export function getDefaultDeploymentsDir(): string {
  const home = os.homedir();
  return path.join(home, ".ray", "deployments");
}

/**
 * Resolves the currently configured deployment directory.
 * Queries Brain /v1/settings with fallback to OS default ~/.ray/deployments.
 */
export async function getDeploymentsDir(): Promise<string> {
  try {
    const res = await fetch(`${BRAIN_URL}/v1/settings`, {
      signal: AbortSignal.timeout(1000),
      headers: { "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.deploymentsPath && typeof data.deploymentsPath === "string") {
        let dir = data.deploymentsPath;
        if (dir.startsWith("~")) {
          dir = path.join(os.homedir(), dir.slice(1));
        }
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
      }
    }
  } catch {
    // Non-blocking fallback
  }

  const defaultDir = getDefaultDeploymentsDir();
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  return defaultDir;
}

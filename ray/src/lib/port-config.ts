/**
 * Port configuration, reservation guards, and conflict detection utilities.
 * Pure logic and environment checks - safe for both server and client usage.
 */

export const PERMANENT_RESERVED_PORTS: number[] = [
  3000, // Ray Dashboard Web Server (Dev)
  3100, // Brain AI Engine Server (Dev)
  3306, // MariaDB / MySQL
  5432, // PostgreSQL
  6379, // Redis
  27017, // MongoDB
];

export interface ClaimedPortInfo {
  port: number;
  name: string;
  type: "dashboard_project" | "deployment" | "pipeline" | "docker" | "system" | "reserved";
  source: string;
  status: string;
  url?: string;
  containerName?: string;
}

export interface PortConflictInfo {
  port: number;
  deploymentId?: string;
  deploymentName: string;
  conflictingWith: string;
  reason: string;
}

export interface PortRegistryResult {
  claimed: ClaimedPortInfo[];
  reserved: number[];
  nextFreePort: number;
  suggestedPorts: number[];
  conflicts: PortConflictInfo[];
  stats: {
    totalClaimed: number;
    projectPortsCount: number;
    deploymentPortsCount: number;
    dockerPortsCount: number;
    systemListenersCount: number;
    conflictsCount: number;
  };
}

/**
 * Resolves configured platform ports across development (3000/3100) and live (.env/RAY_PORT/BRAIN_PORT).
 */
export function getConfiguredPlatformPorts(): {
  devRayPort: number;
  devBrainPort: number;
  liveRayPort?: number;
  liveBrainPort?: number;
} {
  const devRayPort = 3000;
  const devBrainPort = 3100;

  let liveRayPort: number | undefined;
  let liveBrainPort: number | undefined;

  const rawRay = typeof process !== "undefined" ? (process.env.RAY_PORT || process.env.PORT) : undefined;
  if (rawRay) {
    const p = parseInt(rawRay, 10);
    if (!isNaN(p) && p > 0 && p !== devRayPort) {
      liveRayPort = p;
    }
  }

  const rawBrain = typeof process !== "undefined" ? process.env.BRAIN_PORT : undefined;
  if (rawBrain) {
    const p = parseInt(rawBrain, 10);
    if (!isNaN(p) && p > 0 && p !== devBrainPort) {
      liveBrainPort = p;
    }
  } else if (typeof process !== "undefined" && process.env.BRAIN_URL) {
    const m = process.env.BRAIN_URL.match(/:(\d+)/);
    if (m) {
      const p = parseInt(m[1], 10);
      if (!isNaN(p) && p > 0 && p !== devBrainPort) {
        liveBrainPort = p;
      }
    }
  }

  return { devRayPort, devBrainPort, liveRayPort, liveBrainPort };
}

/**
 * Returns all reserved ports, combining dev ports (3000, 3100), system databases, and live ports (e.g. 4567, 4500).
 */
export function getAllReservedPorts(): number[] {
  const ports = new Set<number>(PERMANENT_RESERVED_PORTS);
  const { liveRayPort, liveBrainPort } = getConfiguredPlatformPorts();
  if (liveRayPort) ports.add(liveRayPort);
  if (liveBrainPort) ports.add(liveBrainPort);
  return Array.from(ports);
}

/**
 * Checks whether a given port is a protected platform or system service port.
 */
export function isReservedPlatformPort(port: number): { isReserved: boolean; name?: string } {
  if (port === 3000) return { isReserved: true, name: "Ray Dashboard (Dev)" };
  if (port === 3100) return { isReserved: true, name: "Brain AI Backend (Dev)" };
  if (port === 3306) return { isReserved: true, name: "MySQL / MariaDB" };
  if (port === 5432) return { isReserved: true, name: "PostgreSQL" };
  if (port === 6379) return { isReserved: true, name: "Redis" };
  if (port === 27017) return { isReserved: true, name: "MongoDB" };

  const { liveRayPort, liveBrainPort } = getConfiguredPlatformPorts();
  if (liveRayPort && port === liveRayPort) {
    return { isReserved: true, name: "Ray Dashboard (Live)" };
  }
  if (liveBrainPort && port === liveBrainPort) {
    return { isReserved: true, name: "Brain AI Backend (Live)" };
  }

  return { isReserved: false };
}

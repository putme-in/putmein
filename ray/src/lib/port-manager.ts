import net from "net";
import { exec } from "child_process";
import prisma from "@/lib/prisma";

const BRAIN_URL = process.env.BRAIN_URL || (process.env.BRAIN_PORT ? `http://localhost:${process.env.BRAIN_PORT}` : "http://localhost:3100");

export {
  PERMANENT_RESERVED_PORTS,
  type ClaimedPortInfo,
  type PortConflictInfo,
  type PortRegistryResult,
  getConfiguredPlatformPorts,
  getAllReservedPorts,
  isReservedPlatformPort,
} from "./port-config";
import {
  PERMANENT_RESERVED_PORTS,
  type ClaimedPortInfo,
  type PortConflictInfo,
  type PortRegistryResult,
  getConfiguredPlatformPorts,
  getAllReservedPorts,
} from "./port-config";

/**
 * Robust double-interface socket verification test for macOS Darwin and Linux.
 * Ensures that neither wildcard (0.0.0.0 & ::) nor 0.0.0.0 is bound by Docker or any other daemon.
 */
export function isPortAvailable(port: number): Promise<boolean> {
  const allReserved = getAllReservedPorts();
  if (allReserved.includes(port)) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    // 1. Test wildcard interface (:port)
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => {
        // 2. Test explicit 0.0.0.0 interface (Docker container bindings)
        const server2 = net.createServer();
        server2.once("error", () => resolve(false));
        server2.once("listening", () => {
          server2.close(() => {
            // 3. Test explicit 127.0.0.1 interface
            const server3 = net.createServer();
            server3.once("error", () => resolve(false));
            server3.once("listening", () => {
              server3.close(() => resolve(true));
            });
            server3.listen(port, "127.0.0.1");
          });
        });
        server2.listen(port, "0.0.0.0");
      });
    });
    server.listen(port);
  });
}

/**
 * Scans OS-level listening TCP sockets using lsof.
 */
export function getSystemListeningSockets(): Promise<{ port: number; command: string; pid: string }[]> {
  return new Promise((resolve) => {
    exec("lsof -iTCP -sTCP:LISTEN -P -n", (err, stdout) => {
      if (err || !stdout) {
        return resolve([]);
      }
      const listeners: { port: number; command: string; pid: string }[] = [];
      const lines = stdout.split("\n");
      for (const line of lines.slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 9) {
          const command = parts[0];
          const pid = parts[1];
          const name = parts[8];
          const match = name.match(/:(\d+)$/);
          if (match) {
            const port = parseInt(match[1], 10);
            if (!isNaN(port) && port > 0) {
              listeners.push({ port, command, pid });
            }
          }
        }
      }
      resolve(listeners);
    });
  });
}

/**
 * Aggregates all claimed ports across:
 * 1. Ray Dashboard Projects (RayMonitorProject URLs & dev servers)
 * 2. Ray Deployments (RayDeployment hostPort & deployUrl)
 * 3. Ray CI/CD Pipelines (RayPipeline port)
 * 4. Active Docker Containers (from Brain /v1/containers)
 * 5. System listening sockets (via lsof)
 * 6. Reserved platform ports (3000, 3100, etc.)
 */
export async function getFullPortRegistry(userId?: string): Promise<PortRegistryResult> {
  const claimedMap = new Map<number, ClaimedPortInfo>();
  const conflicts: PortConflictInfo[] = [];

  // 1. Add permanent reserved platform ports (Dev 3000 / 3100)
  claimedMap.set(3000, {
    port: 3000,
    name: "Ray Dashboard (Dev)",
    type: "reserved",
    source: "platform",
    status: "active",
    url: "http://localhost:3000",
  });
  claimedMap.set(3100, {
    port: 3100,
    name: "Brain AI Backend (Dev)",
    type: "reserved",
    source: "platform",
    status: "active",
    url: "http://localhost:3100",
  });

  // 1b. Add configured live platform ports (if different from dev)
  const { liveRayPort, liveBrainPort } = getConfiguredPlatformPorts();
  if (liveRayPort && liveRayPort !== 3000) {
    claimedMap.set(liveRayPort, {
      port: liveRayPort,
      name: "Ray Dashboard (Live)",
      type: "reserved",
      source: "platform",
      status: "active",
      url: `http://localhost:${liveRayPort}`,
    });
  }
  if (liveBrainPort && liveBrainPort !== 3100) {
    claimedMap.set(liveBrainPort, {
      port: liveBrainPort,
      name: "Brain AI Backend (Live)",
      type: "reserved",
      source: "platform",
      status: "active",
      url: `http://localhost:${liveBrainPort}`,
    });
  }

  for (const p of PERMANENT_RESERVED_PORTS) {
    if (!claimedMap.has(p)) {
      let svc = "System Database / Service";
      if (p === 3306) svc = "MySQL / MariaDB";
      if (p === 5432) svc = "PostgreSQL";
      if (p === 6379) svc = "Redis";
      if (p === 27017) svc = "MongoDB";
      claimedMap.set(p, {
        port: p,
        name: svc,
        type: "reserved",
        source: "database",
        status: "reserved",
      });
    }
  }

  // 2. Fetch Ray Dashboard Projects
  let projectPortsCount = 0;
  try {
    const projects = await prisma.rayMonitorProject.findMany({
      ...(userId ? { where: { userId } } : {}),
      select: { id: true, name: true, projectUrl: true, status: true, managedPid: true },
    });

    for (const proj of projects) {
      if (proj.projectUrl) {
        const m = proj.projectUrl.match(/:(\d+)/);
        if (m) {
          const port = parseInt(m[1], 10);
          if (!isNaN(port) && port > 0 && !claimedMap.has(port)) {
            claimedMap.set(port, {
              port,
              name: proj.name,
              type: "dashboard_project",
              source: "RayMonitorProject",
              status: proj.status || "active",
              url: proj.projectUrl,
            });
            projectPortsCount++;
          }
        }
      }
    }
  } catch (err) {
    console.warn("[PortManager] Error querying projects:", err);
  }

  // 3. Fetch Ray Deployments and scan for port conflicts
  let deploymentPortsCount = 0;
  const seenDeploymentPorts = new Map<number, { id: string; name: string }>();

  try {
    const deployments = await prisma.rayDeployment.findMany({
      ...(userId ? { where: { userId } } : {}),
      select: {
        id: true,
        name: true,
        hostPort: true,
        containerName: true,
        deployUrl: true,
        status: true,
      },
    });

    for (const dep of deployments) {
      const port = dep.hostPort || (dep.deployUrl ? parseInt(dep.deployUrl.match(/:(\d+)/)?.[1] || "0", 10) : 0);
      if (port > 0) {
        if (claimedMap.has(port)) {
          const target = claimedMap.get(port)!;
          conflicts.push({
            port,
            deploymentId: dep.id,
            deploymentName: dep.name,
            conflictingWith: target.name,
            reason: `Port :${port} conflicts with ${target.name} (${target.source}).`,
          });
        } else if (seenDeploymentPorts.has(port)) {
          const other = seenDeploymentPorts.get(port)!;
          conflicts.push({
            port,
            deploymentId: dep.id,
            deploymentName: dep.name,
            conflictingWith: other.name,
            reason: `Port :${port} collides with another deployment "${other.name}".`,
          });
        } else {
          claimedMap.set(port, {
            port,
            name: dep.name,
            type: "deployment",
            source: "RayDeployment",
            status: dep.status,
            url: dep.deployUrl || `http://localhost:${port}`,
            containerName: dep.containerName || `ray-${dep.name}`,
          });
          deploymentPortsCount++;
          seenDeploymentPorts.set(port, { id: dep.id, name: dep.name });
        }
      }
    }
  } catch (err) {
    console.warn("[PortManager] Error querying deployments:", err);
  }

  // 4. Fetch Ray CI/CD Pipelines
  try {
    const pipelines = await prisma.rayPipeline.findMany({
      ...(userId ? { where: { userId } } : {}),
      select: { id: true, name: true, port: true, status: true },
    });

    for (const pipe of pipelines) {
      if (pipe.port && pipe.port > 0 && !claimedMap.has(pipe.port)) {
        claimedMap.set(pipe.port, {
          port: pipe.port,
          name: pipe.name,
          type: "pipeline",
          source: "RayPipeline",
          status: pipe.status,
          url: `http://localhost:${pipe.port}`,
        });
      }
    }
  } catch (err) {
    console.warn("[PortManager] Error querying pipelines:", err);
  }

  // 5. Fetch Active Docker Containers from Brain API
  let dockerPortsCount = 0;
  try {
    const cRes = await fetch(`${BRAIN_URL}/v1/containers`, {
      headers: { "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
      signal: AbortSignal.timeout(2500),
    });
    if (cRes.ok) {
      const cData = await cRes.json();
      const containers = cData.containers || [];
      for (const c of containers) {
        if (c.port && c.port > 0) {
          const cleanName = (c.name || "").replace(/^ray-/, "");
          if (!claimedMap.has(c.port)) {
            claimedMap.set(c.port, {
              port: c.port,
              name: cleanName || c.name,
              type: "docker",
              source: "Docker Container",
              status: c.state || "running",
              url: c.url || `http://localhost:${c.port}`,
              containerName: c.name,
            });
            dockerPortsCount++;
          }
        }
      }
    }
  } catch {
    // Brain might be booting or offline
  }

  // 6. Fetch Host System Listening Sockets
  let systemListenersCount = 0;
  const sysSockets = await getSystemListeningSockets();
  for (const sock of sysSockets) {
    systemListenersCount++;
    if (!claimedMap.has(sock.port)) {
      claimedMap.set(sock.port, {
        port: sock.port,
        name: sock.command,
        type: "system",
        source: `PID ${sock.pid} (${sock.command})`,
        status: "listening",
        url: `http://localhost:${sock.port}`,
      });
    }
  }

  // Sort claimed ports numerically
  const claimed = Array.from(claimedMap.values()).sort((a, b) => a.port - b.port);

  // 7. Calculate Next Available Free Ports starting from 4000 (excluding all reserved ports)
  const allReserved = getAllReservedPorts();
  const suggestedPorts: number[] = [];
  let candidate = 4000;
  while (suggestedPorts.length < 5 && candidate < 6000) {
    if (!claimedMap.has(candidate) && !allReserved.includes(candidate)) {
      const available = await isPortAvailable(candidate);
      if (available) {
        suggestedPorts.push(candidate);
      }
    }
    candidate++;
  }

  const nextFreePort = suggestedPorts[0] || 4000;

  return {
    claimed,
    reserved: allReserved,
    nextFreePort,
    suggestedPorts,
    conflicts,
    stats: {
      totalClaimed: claimed.length,
      projectPortsCount,
      deploymentPortsCount,
      dockerPortsCount,
      systemListenersCount,
      conflictsCount: conflicts.length,
    },
  };
}

/**
 * Finds and returns a guaranteed free host port.
 * If preferredPort is passed and available, it returns it.
 * If preferredPort is already in use by another project or listener, it auto-allocates the next free port.
 */
export async function findGuaranteedFreePort(
  preferredPort?: number | null,
  userId?: string
): Promise<{
  port: number;
  reallocated: boolean;
  originalRequested: number | null;
  conflictDetails?: ClaimedPortInfo;
}> {
  const registry = await getFullPortRegistry(userId);
  const claimedMap = new Map(registry.claimed.map((c) => [c.port, c]));
  const allReserved = registry.reserved;

  if (
    preferredPort &&
    preferredPort > 0 &&
    !claimedMap.has(preferredPort) &&
    !allReserved.includes(preferredPort)
  ) {
    const available = await isPortAvailable(preferredPort);
    if (available) {
      return {
        port: preferredPort,
        reallocated: false,
        originalRequested: preferredPort,
      };
    }
  }

  const conflict = preferredPort ? claimedMap.get(preferredPort) : undefined;

  return {
    port: registry.nextFreePort,
    reallocated: !!(preferredPort && preferredPort !== registry.nextFreePort),
    originalRequested: preferredPort || null,
    conflictDetails: conflict,
  };
}

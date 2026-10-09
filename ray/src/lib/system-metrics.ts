import "server-only";
import os from "os";
import fs from "fs/promises";
import path from "path";

type Counter = { times: { user: number; nice: number; sys: number; idle: number; irq: number } };
export function cpuUtilization(before: Counter[], after: Counter[]): number | null {
  if (!before.length || before.length !== after.length) return null;
  let total = 0, idle = 0;
  for (let i = 0; i < before.length; i++) {
    for (const key of ["user", "nice", "sys", "idle", "irq"] as const) {
      const delta = after[i].times[key] - before[i].times[key];
      if (!Number.isFinite(delta) || delta < 0) return null;
      total += delta; if (key === "idle") idle += delta;
    }
  }
  return total > 0 ? Math.round(Math.max(0, Math.min(100, (1 - idle / total) * 100)) * 10) / 10 : null;
}
export function linuxAvailableMemory(text: string, total: number): number | null {
  const match = text.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
  const available = match ? Number(match[1]) * 1024 : NaN;
  return Number.isFinite(available) && available >= 0 && available <= total ? available : null;
}
function bytes(value: number) { return `${(value / 1024 ** 3).toFixed(2)} GB`; }
async function collect() {
  const before = os.cpus();
  await new Promise(resolve => setTimeout(resolve, 300));
  const after = os.cpus();
  const totalMem = os.totalmem();
  let available = os.freemem();
  let memoryBasis = "Total minus free memory";
  if (process.platform === "linux") {
    try {
      const result = linuxAvailableMemory(await fs.readFile("/proc/meminfo", "utf8"), totalMem);
      if (result !== null) { available = result; memoryBasis = "Total minus available memory (excludes reclaimable cache)"; }
    } catch { /* use portable OS counters */ }
  }
  let disk: number | null = null, diskFormatted = "Unavailable";
  const diskPath = path.parse(process.cwd()).root;
  try {
    const stat = await fs.statfs(diskPath);
    const total = stat.blocks * stat.bsize, used = (stat.blocks - stat.bfree) * stat.bsize;
    if (total > 0) { disk = Math.round(used / total * 1000) / 10; diskFormatted = `${bytes(used)} / ${bytes(total)}`; }
  } catch { /* unsupported filesystem metrics are not zero usage */ }
  let uptimeSeconds: number | null = null;
  try { uptimeSeconds = os.uptime(); } catch { /* restricted OS access */ }
  return {
    cpu: cpuUtilization(before, after), memory: totalMem > 0 ? Math.round((totalMem - available) / totalMem * 1000) / 10 : null,
    disk, diskPath, diskFormatted, memoryFormatted: `${bytes(totalMem - available)} / ${bytes(totalMem)}`, memoryBasis,
    uptime: uptimeSeconds === null ? "Unavailable" : `${Math.floor(uptimeSeconds / 86400)}d ${Math.floor(uptimeSeconds % 86400 / 3600)}h ${Math.floor(uptimeSeconds % 3600 / 60)}m`, uptimeSeconds,
    loadAvg: process.platform === "win32" ? null : os.loadavg().map(value => Math.round(value * 100) / 100),
    cpusCount: after.length, cpuModel: after[0]?.model || "Unavailable", name: os.hostname(), os: `${os.type()} ${os.release()}`, arch: os.arch(),
    sampledAt: new Date().toISOString(), scope: "Ray server OS view",
  };
}
let cached: Awaited<ReturnType<typeof collect>> | undefined;
let pending: ReturnType<typeof collect> | undefined;
export async function getSystemMetrics() {
  if (cached && Date.now() - Date.parse(cached.sampledAt) < 2000) return cached;
  if (!pending) pending = collect().then(result => { cached = result; return result; }).finally(() => { pending = undefined; });
  return pending;
}

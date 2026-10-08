import { createHash } from "node:crypto";

export const LOG_RETENTION_DAYS = 30;
export const LOG_RETENTION_KEEP = 10;
export const LOG_RETENTION_BATCH = 50;

export type LogSelection = { kind: "deployment" | "pipeline"; id: string; fingerprint: string };
export type LogPreview = LogSelection & { name: string; createdAt: string; bytes: number };

export function logFingerprint(kind: string, row: unknown): string {
  return createHash("sha256").update(JSON.stringify([kind, row])).digest("hex");
}

// Retain stage names, statuses, timing and other metadata. Unknown or malformed
// stage formats are left for manual review instead of discarding their contents.
export function withoutStageLogs(raw: string | null): { value: string | null; bytes: number } | null {
  if (!raw) return { value: raw, bytes: 0 };
  try {
    const stages: unknown = JSON.parse(raw);
    if (!Array.isArray(stages) || stages.some(stage => !stage || typeof stage !== "object" || Array.isArray(stage))) return null;
    let bytes = 0;
    const cleaned = stages.map(stage => {
      const copy = { ...stage } as Record<string, unknown>;
      if ("logs" in copy) {
        if (typeof copy.logs !== "string" && copy.logs !== null) throw new Error("Unknown stage log format");
        if (typeof copy.logs === "string") bytes += Buffer.byteLength(copy.logs);
        delete copy.logs;
      }
      return copy;
    });
    return { value: JSON.stringify(cleaned), bytes };
  } catch {
    return null;
  }
}

export function validLogSelections(value: unknown): value is LogSelection[] {
  return Array.isArray(value) && value.length > 0 && value.length <= LOG_RETENTION_BATCH * 2 &&
    value.every(item => item && ["deployment", "pipeline"].includes(item.kind) &&
      typeof item.id === "string" && item.id.length > 0 && item.id.length <= 191 &&
      typeof item.fingerprint === "string" && /^[a-f0-9]{64}$/.test(item.fingerprint)) &&
    new Set(value.map(item => `${item.kind}:${item.id}`)).size === value.length;
}

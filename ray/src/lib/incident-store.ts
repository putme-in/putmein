import "server-only";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createHash, randomUUID } from "crypto";
import type { Incident, IncidentState } from "./incidents";

type RecordState = { fingerprint: string; state: IncidentState; revision: number; history: Incident["history"] };
const root = () => process.env.RAY_INCIDENT_STATE_DIR || path.join(os.homedir(), ".ray", "incident-states");
function location(owner: string, id: string) { return path.join(root(), createHash("sha256").update(JSON.stringify([owner, id])).digest("hex") + ".json"); }
export async function readIncidentState(owner: string, incident: Incident): Promise<Incident> {
  try {
    const file = location(owner, incident.id);
    const info = await fs.lstat(file);
    if (!info.isFile() || info.size > 32768) throw new Error("Incident state is not a bounded regular file");
    const record = JSON.parse(await fs.readFile(file, "utf8")) as RecordState;
    if (!Number.isSafeInteger(record.revision) || record.revision < 1 || !["open", "acknowledged", "dismissed"].includes(record.state) || typeof record.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(record.fingerprint) || !Array.isArray(record.history) || record.history.length > 20 || record.history.some(event => !event || !["open", "acknowledged", "dismissed"].includes(event.state) || typeof event.at !== "string" || !Number.isFinite(Date.parse(event.at)))) throw new Error("Invalid incident state");
    // Changed scan/deployment state must not inherit a dismissal for older evidence.
    if (record.fingerprint !== incident.fingerprint) return { ...incident, revision: record.revision, history: record.history.slice(-20) };
    return { ...incident, state: record.state, revision: record.revision, history: record.history.slice(-20) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return incident; throw error; }
}
export async function updateIncidentState(owner: string, incident: Incident, state: IncidentState, expected: number) {
  await fs.mkdir(root(), { recursive: true, mode: 0o700 });
  const file = location(owner, incident.id);
  // Cross-request/process exclusion; never steal a potentially active writer's lock.
  const lock = await fs.open(file + ".lock", "wx", 0o600);
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    const current = await readIncidentState(owner, incident);
    if (current.revision !== expected) throw new Error("STALE");
    const record: RecordState = { fingerprint: incident.fingerprint, state, revision: current.revision + 1,
      history: [...current.history, { state, at: new Date().toISOString() }].slice(-20) };
    await fs.writeFile(temp, JSON.stringify(record), { mode: 0o600, flag: "wx" });
    await fs.rename(temp, file);
    return { ...incident, ...record };
  } finally { await lock.close(); await fs.rm(file + ".lock", { force: true }); await fs.rm(temp, { force: true }).catch(() => {}); }
}

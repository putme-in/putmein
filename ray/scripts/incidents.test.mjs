import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareIncidents, incidentCounts } from "../src/lib/incidents.ts";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/lib/incident-store.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const module = { exports: {} };
// Next supplies this build-time marker; all filesystem operations remain real fixture operations.
new Function("require", "module", "exports", code)(id => id === "server-only" ? {} : require(id), module, module.exports);
const { readIncidentState, updateIncidentState } = module.exports;
const item = { id: "security:scan", kind: "security", sourceId: "scan", fingerprint: "a".repeat(64), title: "Scan", projectName: "app", createdAt: "2026-10-05T00:00:00.000Z", href: "/security", state: "open", revision: 0, history: [], severity: "critical" };
test("handling is owner-scoped, versioned and reset by changed evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ray-incidents-"));
  const previous = process.env.RAY_INCIDENT_STATE_DIR;
  process.env.RAY_INCIDENT_STATE_DIR = root;
  try {
    const saved = await updateIncidentState("owner", item, "acknowledged", 0);
    assert.equal(saved.revision, 1);
    assert.equal((await readIncidentState("other", item)).state, "open");
    assert.equal((await readIncidentState("owner", item)).state, "acknowledged");
    await assert.rejects(updateIncidentState("owner", item, "dismissed", 0), /STALE/);
    const dismissed = await updateIncidentState("owner", item, "dismissed", 1);
    assert.equal(dismissed.history.length, 2);
    const changed = await readIncidentState("owner", { ...item, fingerprint: "b".repeat(64) });
    assert.equal(changed.state, "open"); assert.equal(changed.revision, 2);
    assert.equal((await updateIncidentState("owner", { ...item, fingerprint: "b".repeat(64) }, "open", 2)).revision, 3);
    const files = await readdir(root); assert.equal(files.length, 1);
    assert.equal(JSON.parse(await readFile(path.join(root, files[0]), "utf8")).history.length, 3);
    const attempts = await Promise.allSettled([
      updateIncidentState("owner", { ...item, fingerprint: "b".repeat(64) }, "acknowledged", 3),
      updateIncidentState("owner", { ...item, fingerprint: "b".repeat(64) }, "dismissed", 3),
    ]);
    assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await readIncidentState("owner", { ...item, fingerprint: "b".repeat(64) })).revision, 4);
  } finally { if (previous === undefined) delete process.env.RAY_INCIDENT_STATE_DIR; else process.env.RAY_INCIDENT_STATE_DIR = previous; await rm(root, { recursive: true, force: true }); }
});
test("ordering and counts cover all source types", () => {
  const incidents = [{ ...item, severity: "warn", state: "dismissed", kind: "runtime" }, { ...item, severity: "error", state: "acknowledged", kind: "deployment" }, item].sort(compareIncidents);
  assert.equal(incidents[0].severity, "critical");
  assert.deepEqual(incidentCounts(incidents), { open: 1, acknowledged: 1, dismissed: 1, runtime: 1, deployment: 1, security: 1 });
});
test("source aggregation scopes owners and suppresses only known security duplicates", async () => {
  const at = new Date("2026-10-05T00:00:00Z");
  const calls = [];
  const prisma = {
    rayMonitorAlert: { findMany: async query => { calls.push(query.where.project.userId); return [
      { id: "security_scan_1", severity: "critical", message: "duplicate", dismissed: false, createdAt: at, projectId: "project", project: { name: "app" } },
      { id: "security_missing", severity: "critical", message: "keep unmatched", dismissed: false, createdAt: at, projectId: "project", project: { name: "app" } },
    ]; } },
    rayDeployment: { findMany: async query => { calls.push(query.where.userId); return [{ id: "deployment", name: "app", status: "failed", createdAt: at, updatedAt: at }]; } },
    raySecurityScan: { findMany: async query => { calls.push(query.where.userId); return [{ id: "scan_1", projectName: "app", status: "danger", dangerCount: 2, warnCount: 0, overridden: true, createdAt: at, updatedAt: at }]; } },
  };
  const source = readFileSync(new URL("../src/lib/incident-sources.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(id => id === "server-only" ? {} : id === "./prisma" ? prisma : require(id), module, module.exports);
  const { items } = await module.exports.loadIncidentSources("owner");
  assert.deepEqual(calls, ["owner", "owner", "owner"]);
  assert.equal(items.length, 3);
  assert.equal(items.some(item => item.sourceId === "security_scan_1"), false);
  assert.equal(items.some(item => item.sourceId === "security_missing"), true);
  assert.equal(items.find(item => item.kind === "security").severity, "critical");
});

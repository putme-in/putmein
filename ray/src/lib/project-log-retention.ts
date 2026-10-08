import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  LOG_RETENTION_BATCH, LOG_RETENTION_DAYS, LOG_RETENTION_KEEP,
  logFingerprint, withoutStageLogs, type LogPreview, type LogSelection,
} from "./log-retention";

export async function projectLogRetention(userId: string, projectId: string, selections?: LogSelection[]) {
  if (selections) {
    // Serializable reads hold the selected rows stable through the update, including
    // log columns whose database collation may otherwise compare case-insensitively.
    return prisma.$transaction(
      tx => collectLogRetention(tx, userId, projectId, selections),
      { isolationLevel: "Serializable", timeout: 15000 },
    );
  }
  return collectLogRetention(prisma, userId, projectId);
}

async function collectLogRetention(db: Prisma.TransactionClient, userId: string, projectId: string, selections?: LogSelection[]) {
  const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 86400000);
  const scope = { userId, projectId };
  const pipelineScope = { pipeline: scope };
  const [recentDeployments, recentRuns] = await Promise.all([
    db.rayDeployment.findMany({
      where: scope, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LOG_RETENTION_KEEP, select: { id: true },
    }),
    db.rayPipelineRun.findMany({
      where: pipelineScope, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LOG_RETENTION_KEEP, select: { id: true },
    }),
  ]);
  const deploymentIds = selections?.filter(item => item.kind === "deployment").map(item => item.id);
  const runIds = selections?.filter(item => item.kind === "pipeline").map(item => item.id);
  const [deployments, runs] = await Promise.all([
    db.rayDeployment.findMany({
      where: {
        ...scope,
        id: { notIn: recentDeployments.map(row => row.id), ...(deploymentIds ? { in: deploymentIds } : {}) },
        status: { in: ["failed", "stopped"] },
        updatedAt: { lt: cutoff }, createdAt: { lt: cutoff },
        buildLogs: { not: null },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: LOG_RETENTION_BATCH,
      select: { id: true, name: true, createdAt: true, updatedAt: true, status: true, buildLogs: true },
    }),
    db.rayPipelineRun.findMany({
      where: {
        ...pipelineScope,
        id: { notIn: recentRuns.map(row => row.id), ...(runIds ? { in: runIds } : {}) },
        status: { in: ["success", "failed"] }, createdAt: { lt: cutoff },
        OR: [{ logs: { not: null } }, { stages: { contains: '"logs":' } }],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: LOG_RETENTION_BATCH,
      select: { id: true, createdAt: true, status: true, logs: true, stages: true, pipeline: { select: { name: true } } },
    }),
  ]);
  const items: LogPreview[] = [];
  let cleared = 0;
  let manualReview = 0;
  const approved = new Map(selections?.map(item => [`${item.kind}:${item.id}`, item.fingerprint]));
  for (const row of deployments) {
    const fingerprint = logFingerprint("deployment", row);
    if (selections) {
      if (approved.get(`deployment:${row.id}`) !== fingerprint) continue;
      // Compare the exact old contents and status: a concurrent build or log write
      // makes this a no-op. Explicit updatedAt preserves historical ordering.
      const result = await db.rayDeployment.updateMany({
        where: { ...scope, id: row.id, status: row.status, updatedAt: row.updatedAt, buildLogs: row.buildLogs },
        data: { buildLogs: null, updatedAt: row.updatedAt },
      });
      cleared += result.count;
    } else {
      items.push({ kind: "deployment", id: row.id, fingerprint, name: row.name, createdAt: row.createdAt.toISOString(), bytes: Buffer.byteLength(row.buildLogs || "") });
    }
  }
  for (const row of runs) {
    const stripped = withoutStageLogs(row.stages);
    if (!stripped) { manualReview++; continue; }
    const fingerprint = logFingerprint("pipeline", row);
    if (selections) {
      if (approved.get(`pipeline:${row.id}`) !== fingerprint) continue;
      const result = await db.rayPipelineRun.updateMany({
        where: { ...pipelineScope, id: row.id, status: row.status, logs: row.logs, stages: row.stages },
        data: { logs: null, stages: stripped.value },
      });
      cleared += result.count;
    } else {
      items.push({ kind: "pipeline", id: row.id, fingerprint, name: row.pipeline.name, createdAt: row.createdAt.toISOString(), bytes: Buffer.byteLength(row.logs || "") + stripped.bytes });
    }
  }
  return { items, cleared, manualReview, skipped: selections ? selections.length - cleared : 0, batchLimit: LOG_RETENTION_BATCH * 2 };
}

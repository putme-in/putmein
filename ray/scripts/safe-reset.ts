import prisma from "../src/lib/prisma";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

async function main() {
  console.log("Starting safe data cleanup...");

  // 1. Fetch monitor projects so we can notify Brain to clear in-memory state
  try {
    const projects = await prisma.rayMonitorProject.findMany({
      select: { id: true, name: true },
    });

    for (const p of projects) {
      try {
        await fetch(`${BRAIN_URL}/v1/monitor/projects/${p.id}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(1000),
        });
      } catch {
        // non-blocking
      }
    }
  } catch (err) {
    console.warn("Notice: Could not notify Brain:", (err as Error).message);
  }

  // 2. Safely delete records in proper foreign-key order
  const deletedRuns = await prisma.rayPipelineRun.deleteMany({});
  console.log(`Deleted ${deletedRuns.count} pipeline runs.`);

  const deletedPipelines = await prisma.rayPipeline.deleteMany({});
  console.log(`Deleted ${deletedPipelines.count} pipelines.`);

  const deletedDeployments = await prisma.rayDeployment.deleteMany({});
  console.log(`Deleted ${deletedDeployments.count} deployments.`);

  const deletedAlerts = await prisma.rayMonitorAlert.deleteMany({});
  console.log(`Deleted ${deletedAlerts.count} monitor alerts.`);

  const deletedProjects = await prisma.rayMonitorProject.deleteMany({});
  console.log(`Deleted ${deletedProjects.count} monitor projects.`);

  // 3. Attempt to stop and remove any ray-* docker containers if daemon is running
  try {
    const { stdout } = await execAsync('docker ps -a --filter "name=ray-" --format "{{.ID}}"');
    const containerIds = stdout.trim().split("\n").filter(Boolean);
    if (containerIds.length > 0) {
      console.log(`Removing ${containerIds.length} Docker containers...`);
      await execAsync(`docker rm -f ${containerIds.join(" ")}`);
      console.log("Docker containers removed.");
    } else {
      console.log("No ray-* Docker containers found.");
    }
  } catch {
    console.log("Docker daemon not running or no containers to remove.");
  }

  console.log("Safe cleanup completed successfully!");
}

main()
  .catch((err) => {
    console.error("Cleanup error:", err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });

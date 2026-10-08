import "server-only";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import { createHash, randomUUID } from "crypto";
import { parseProjectSetup, type ProjectSetup } from "./project-setup";
import { resolveProjectSource } from "./project-source";
import { detectFramework } from "./framework-detection";
import { getAllReservedPorts } from "./port-config";

// Platform state lives outside uploaded/cloned code, including private environment values.
// Atomic replacements keep a failed write from corrupting the previous configuration.
const root = () => process.env.RAY_SETUP_DIR || path.join(os.homedir(), ".ray", "project-setups");
function configPath(userId: string, projectId: string) {
  if (!userId || !projectId) throw new Error("Setup requires an owner and project.");
  const key = createHash("sha256").update(JSON.stringify([userId, projectId])).digest("hex");
  return path.join(root(), `${key}.json`);
}
export async function readProjectSetup(userId: string, projectId: string): Promise<ProjectSetup | null> {
  try { return parseProjectSetup(JSON.parse(await fs.readFile(configPath(userId, projectId), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function saveProjectSetup(userId: string, projectId: string, setup: ProjectSetup) {
  const parsed = parseProjectSetup(setup);
  await fs.mkdir(root(), { recursive: true, mode: 0o700 });
  const destination = configPath(userId, projectId);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(parsed), { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, destination);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}
export async function deleteProjectSetup(userId: string, projectId: string) {
  await fs.rm(configPath(userId, projectId), { force: true });
}
export function validateSetupSource(setup: ProjectSetup) {
  if (setup.hostPort && [...getAllReservedPorts(), 4567, 4500].includes(setup.hostPort)) throw new Error("This host port is reserved for the platform or a system service.");
  const source = resolveProjectSource(setup.sourceRoot, setup.appDirectory);
  return { ...setup, ...source };
}
export function deploymentSetupPayload(setup: ProjectSetup) {
  if (!setup.dockerEnabled && !setup.startCommand.trim()) throw new Error("Enter a production start command for host deployment.");
  return { healthCheck: setup.healthCheck, routingMode: setup.routingMode, projectUrl: setup.projectUrl, dockerEnabled: setup.dockerEnabled, framework: setup.framework === "auto" ? detectFramework(resolveProjectSource(setup.sourceRoot, setup.appDirectory).projectPath)?.slug || "auto" : setup.framework, buildCommand: setup.buildCommand, startCommand: setup.startCommand,
    hostPort: setup.hostPort ?? undefined, containerPort: setup.dockerEnabled ? setup.containerPort ?? undefined : undefined, envVars: setup.envVars };
}

/** Registration may start inside a Git subdirectory. Preserve its repo-relative path. */
export async function rebaseSetupToGitRoot(setup: ProjectSetup): Promise<ProjectSetup> {
  const selected = resolveProjectSource(setup.sourceRoot, setup.appDirectory);
  try {
    const { stdout } = await promisify(execFile)("git", ["-C", selected.projectPath, "rev-parse", "--show-toplevel"], { timeout: 3000 });
    const root = stdout.trim();
    const source = resolveProjectSource(root, path.relative(root, selected.projectPath));
    return { ...setup, sourceRoot: source.sourceRoot, appDirectory: source.appDirectory.split(path.sep).join("/") };
  } catch { return setup; }
}

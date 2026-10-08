import "server-only";
import fs from "fs/promises";
import path from "path";
import { getDeploymentsDir } from "./settings";
import { cloneGitSource } from "./git-source";
export async function prepareGitSource(userId: string, repoUrl: string, branch = "") {
  const root = path.join(await getDeploymentsDir(), ".git-setup");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const staging = await fs.mkdtemp(path.join(root, "source-"));
  try { const sourceRoot = path.join(staging, "repo"); return { sourceRoot, ...await cloneGitSource(userId, repoUrl, branch, sourceRoot) }; }
  catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
}

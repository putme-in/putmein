import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import prisma from "@/lib/prisma";

const execFileAsync = promisify(execFile);

/**
 * Detects if a directory is a Git repository and returns its origin remote URL.
 * Returns null if the path is not a git repository or has no remote.
 */
export async function detectGitRemoteUrl(projectPath: string): Promise<string | null> {
  if (!projectPath || !fs.existsSync(projectPath)) return null;

  // 1. Try reading .git/config directly for speed
  try {
    const gitConfigPath = path.join(projectPath, ".git", "config");
    if (fs.existsSync(gitConfigPath)) {
      const content = fs.readFileSync(gitConfigPath, "utf-8");
      const match = content.match(/\[remote\s+"origin"\][^\[]*?url\s*=\s*([^\r\n]+)/i);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
  } catch { /* fallback to git cli */ }

  // 2. Try git remote get-url origin
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectPath, "remote", "get-url", "origin"], {
      timeout: 3000,
      windowsHide: true,
    });
    const url = stdout.trim();
    if (url) return url;
  } catch { /* not a git repo */ }

  return null;
}

/**
 * Ensures a CI/CD pipeline exists for a Git repository or GitHub URL.
 * If the project is NOT a Git repo and no repoUrl is provided, it returns null
 * (only git/github projects are added to CI/CD).
 */
export async function ensureGitPipeline(
  userId: string,
  name: string,
  repoUrlOrPath: string,
  options?: {
    projectId?: string;
    branch?: string;
    port?: number;
  }
) {
  if (!userId || !repoUrlOrPath) return null;

  let repoUrl: string | null = null;
  const isUrl =
    repoUrlOrPath.startsWith("http://") ||
    repoUrlOrPath.startsWith("https://") ||
    repoUrlOrPath.startsWith("git@") ||
    repoUrlOrPath.includes("github.com");

  if (isUrl) {
    repoUrl = repoUrlOrPath.trim();
  } else {
    // Check if the local path is a git repository
    repoUrl = await detectGitRemoteUrl(repoUrlOrPath);
  }

  // If no Git remote is associated, do not add to CI/CD
  if (!repoUrl) return null;

  const branch = options?.branch || "main";
  const port = options?.port || 3000;
  const projectId = options?.projectId || null;

  // Check if pipeline already exists for this user and repository
  const existing = await prisma.rayPipeline.findFirst({
    where: {
      userId,
      OR: [
        { repoUrl },
        { name: name.trim() },
      ],
    },
  });

  if (existing) {
    return prisma.rayPipeline.update({
      where: { id: existing.id },
      data: {
        repoUrl,
        projectId: projectId || existing.projectId,
        updatedAt: new Date(),
      },
    });
  }

  return prisma.rayPipeline.create({
    data: {
      userId,
      name: name.trim(),
      repoUrl,
      branch,
      autoDeploy: true,
      port,
      projectId,
      status: "idle",
    },
  });
}

/**
 * Syncs all repositories from a user's connected GitHub account into RayPipeline records.
 */
export async function syncGithubReposToPipelines(userId: string): Promise<number> {
  if (!userId) return 0;

  try {
    const integration = await prisma.rayGithubIntegration.findFirst({
      where: { userId },
    });

    if (!integration || !integration.accessToken) {
      return 0;
    }

    const { fetchAllAccessibleRepos } = await import("./github-app");
    const repos = await fetchAllAccessibleRepos(userId);
    if (!Array.isArray(repos) || repos.length === 0) return 0;

    let createdCount = 0;
    for (const repo of repos) {
      const repoUrl = repo.clone_url || repo.html_url;
      const repoName = repo.name || repo.full_name;
      if (!repoUrl || !repoName) continue;

      const existing = await prisma.rayPipeline.findFirst({
        where: {
          userId,
          OR: [{ repoUrl }, { name: repoName }],
        },
      });

      if (!existing) {
        await prisma.rayPipeline.create({
          data: {
            userId,
            name: repoName,
            repoUrl,
            branch: repo.default_branch || "main",
            autoDeploy: true,
            port: 3000,
            status: "idle",
          },
        });
        createdCount++;
      }
    }

    return createdCount;
  } catch (err) {
    console.error("syncGithubReposToPipelines error:", err);
    return 0;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import fs from "fs/promises";
import path from "path";
import { verifyToken } from "@/lib/auth";
import { getDeploymentsDir } from "@/lib/settings";
import { signPreparedSource } from "@/lib/prepared-source";
import { cloneGitSource } from "@/lib/git-source";
import { normalizeGitUrl } from "@/lib/git-url";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(req: NextRequest) {
  const token = (await cookies()).get("ray_token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let staging: string | undefined;
  try {
    const body = await req.json();
    const repoUrl = normalizeGitUrl(body?.repoUrl);
    if (body.branch !== undefined && (typeof body.branch !== "string" || body.branch.length > 255)) throw new Error("Choose a valid branch.");
    const root = path.join(await getDeploymentsDir(), ".git-setup");
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    staging = await fs.mkdtemp(path.join(root, "source-"));
    const sourceRoot = path.join(staging, "repo");
    const source = { sourceRoot, ...await cloneGitSource(user.userId, repoUrl, body.branch || "", sourceRoot) };
    const preparedSource = await signPreparedSource(user.userId, source);
    return NextResponse.json({ ...source, name: new URL(repoUrl).pathname.split("/").pop()!.replace(/\.git$/, ""), preparedSource }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare Git source." }, { status: 400 });
  }
}

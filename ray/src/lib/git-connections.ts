import "server-only";
import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes } from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { normalizeGitUrl, gitRepositoryKey } from "./git-url";

export interface GitConnection { id: string; name: string; repoUrl: string; username: string; private: boolean }
interface Stored extends GitConnection { token: string }
function root(userId: string) {
  return path.join(process.env.RAY_GIT_CONNECTIONS_DIR || path.join(os.homedir(), ".ray", "git-connections"), createHash("sha256").update(userId).digest("hex"));
}
function key() {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new Error("Server authentication is not configured.");
  return createHmac("sha256", secret).update("ray:git-credentials:v1").digest();
}
function file(userId: string, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid Git connection.");
  return path.join(root(userId), `${id}.json`);
}
function publicRecord({ token: _token, ...record }: Stored): GitConnection { return record; }
async function read(userId: string, id: string): Promise<Stored | null> {
  let data: string;
  try { data = await fs.readFile(file(userId, id), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("Could not read Git connection storage."); }
  try {
    const envelope = JSON.parse(data);
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from(`${userId}:${id}`));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8"));
  } catch { throw new Error("Cannot decrypt Git connections. Restore the original server authentication key or recreate the connection."); }
}
export async function listGitConnections(userId: string): Promise<GitConnection[]> {
  let files: string[];
  try { files = await fs.readdir(root(userId)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw new Error("Could not read Git connection storage."); }
  const records: GitConnection[] = [];
  for (const name of files.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
    const record = await read(userId, name.slice(0, -5));
    if (record) records.push(publicRecord(record));
  }
  return records.sort((a, b) => a.name.localeCompare(b.name));
}
export async function getGitConnection(userId: string, repoUrl: string): Promise<Stored | null> {
  const id = createHash("sha256").update(gitRepositoryKey(repoUrl)).digest("hex");
  return read(userId, id);
}
export async function saveGitConnection(userId: string, input: Record<string, unknown>) {
  const repoUrl = normalizeGitUrl(input.repoUrl);
  const id = createHash("sha256").update(gitRepositoryKey(repoUrl)).digest("hex");
  const previous = await read(userId, id);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const username = typeof input.username === "string" ? input.username.trim() : "";
  if (!name || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) throw new Error("Enter a connection name of at most 100 characters.");
  if (typeof input.private !== "boolean") throw new Error("Choose public or private access.");
  const token = input.private ? (typeof input.token === "string" && input.token ? input.token : previous?.token || "") : "";
  if (input.private && (!username || username.length > 256 || /[:\x00-\x1f\x7f]/.test(username) || !token || token.length > 8192 || /[\x00-\x1f\x7f]/.test(token))) throw new Error("Private repositories require a valid username and access token/password.");
  const record: Stored = { id, name, repoUrl, username: input.private ? username : "", private: input.private, token };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`${userId}:${id}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(record), "utf8"), cipher.final()]);
  await fs.mkdir(root(userId), { recursive: true, mode: 0o700 });
  const target = file(userId, id), tmp = `${target}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify({ version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") }), { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, target);
  } finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
  return publicRecord(record);
}
export async function deleteGitConnection(userId: string, id: string) { await fs.rm(file(userId, id), { force: true }); }

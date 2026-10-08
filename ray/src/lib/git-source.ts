import "server-only";
import { execFile } from "child_process";
import { promisify } from "util";
import dns from "dns/promises";
import { BlockList, isIP } from "net";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { normalizeGitUrl } from "./git-url";
import { getGitConnection } from "./git-connections";
import { getEffectiveGitHubToken } from "./github-app";
const exec = promisify(execFile);
const blocked = new BlockList();
for (const [ip, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]] as const) blocked.addSubnet(ip, bits, "ipv4");
const global6 = new BlockList(); global6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6"); blocked.addSubnet("2001:db8::", 32, "ipv6"); blocked.addSubnet("2002::", 16, "ipv6");
export function publicGitAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4") : family === 6 && global6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

/** All network Git operations use a clean environment, pinned DNS and scoped auth. */
export async function cloneGitSource(userId: string, input: string, branchInput: string, destination: string, remoteOnly = false) {
  const repoUrl = normalizeGitUrl(input), url = new URL(repoUrl);
  const privateHosts = (process.env.RAY_GIT_PRIVATE_HOSTS || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length || (!privateHosts.includes(hostname.toLowerCase()) && addresses.some(item => !publicGitAddress(item.address)))) throw new Error("This Git host resolves to a private/reserved address. The server operator must allow it in RAY_GIT_PRIVATE_HOSTS.");
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "ray-git-"));
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: work, XDG_CONFIG_HOME: work, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", GIT_LFS_SKIP_SMUDGE: "1", GIT_ALLOW_PROTOCOL: "https", LC_ALL: "C" };
  try {
    const { stdout: capabilities } = await exec("git", ["help", "--config"], { env, cwd: work, timeout: 5000 });
    if (!capabilities.includes("http.curloptResolve")) throw new Error("The installed Git must support http.curloptResolve for safe repository access.");
    const connection = await getGitConnection(userId, repoUrl);
    let auth = connection?.private ? `${connection.username}:${connection.token}` : "";
    // An explicitly saved public source does not inherit account credentials.
    if (!connection && url.hostname === "github.com" && !url.port) {
      const token = await getEffectiveGitHubToken(userId);
      if (token) auth = `x-access-token:${token}`;
    }
    const address = addresses[0];
    const entries: [string, string][] = [
      ["http.followRedirects", "false"], ["http.sslVerify", "true"], ["http.proxy", ""],
      ["http.curloptResolve", `${url.hostname}:${url.port || "443"}:${address.family === 6 ? `[${address.address}]` : address.address}`],
      ["credential.helper", ""], ["core.hooksPath", work], ["init.templateDir", work], ["protocol.allow", "never"], ["protocol.https.allow", "always"],
    ];
    if (auth) entries.push([`http.${repoUrl}.extraheader`, `Authorization: Basic ${Buffer.from(auth).toString("base64")}`]);
    env.GIT_CONFIG_COUNT = String(entries.length);
    entries.forEach(([key, value], i) => { env[`GIT_CONFIG_KEY_${i}`] = key; env[`GIT_CONFIG_VALUE_${i}`] = value; });
    let branch = branchInput.trim();
    if (!branch) {
      const { stdout } = await exec("git", ["ls-remote", "--symref", "--", repoUrl, "HEAD"], { env, cwd: work, timeout: 30000, maxBuffer: 1024 * 1024 });
      branch = stdout.match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1] || "";
    }
    if (!branch || branch.length > 255 || branch.startsWith("-") || branch.includes("@{") || /[\x00-\x20\x7f]/.test(branch)) throw new Error("Choose a valid branch name.");
    await exec("git", ["check-ref-format", `refs/heads/${branch}`], { env, cwd: work, timeout: 5000 });
    if (remoteOnly) {
      const { stdout } = await exec("git", ["ls-remote", "--", repoUrl, `refs/heads/${branch}`], { env, cwd: work, timeout: 15000, maxBuffer: 1024 * 1024 });
      const commitHash = stdout.trim().match(/^([a-f0-9]{40}|[a-f0-9]{64})\s/i)?.[1];
      if (!commitHash) throw new Error("Remote branch not found");
      return { repoUrl, branch, commitHash, commitMessage: "", author: "" };
    }
    await exec("git", ["clone", "--depth", "1", "--single-branch", "--no-recurse-submodules", "--branch", branch, "--", repoUrl, destination], { env, cwd: work, timeout: 90000, maxBuffer: 1024 * 1024 });
    const info = async (args: string[]) => (await exec("git", ["-C", destination, ...args], { env, cwd: work, timeout: 5000, maxBuffer: 1024 * 1024 })).stdout.trim();
    return { repoUrl, branch, commitHash: await info(["rev-parse", "HEAD"]), commitMessage: await info(["log", "-1", "--pretty=%B"]), author: await info(["log", "-1", "--pretty=%an"]) };
  } catch {
    // Never propagate exec errors: remote stderr and environment values can contain credentials.
    throw new Error("Could not read the Git repository. Check the HTTPS clone URL, branch, saved access credentials, server Git version and network connection.");
  } finally { await fs.rm(work, { recursive: true, force: true }); }
}

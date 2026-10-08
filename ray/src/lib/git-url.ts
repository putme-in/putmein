/** Only credential-free HTTPS clone URLs are accepted by the managed Git path. */
export function normalizeGitUrl(input: unknown): string {
  if (typeof input !== "string" || input.length > 2048 || /[\s\x00-\x1f\x7f\\]/.test(input)) throw new Error("Enter an HTTPS repository clone URL without credentials.");
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Enter an HTTPS repository clone URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.hostname.endsWith(".")) throw new Error("Use HTTPS without a username, token, query or fragment in the URL.");
  if (!/^\/[A-Za-z0-9_~.@/-]+$/.test(url.pathname) || url.pathname.includes("//")) throw new Error("Use the repository's HTTPS clone URL.");
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname || url.pathname === "/") throw new Error("Repository path is required.");
  return url.toString();
}
export function gitRepositoryKey(input: string): string {
  const url = new URL(normalizeGitUrl(input));
  url.pathname = url.pathname.replace(/\.git$/, "");
  if (url.hostname === "github.com") url.pathname = url.pathname.toLowerCase();
  return url.toString();
}

export function validateGitRepoUrl(input: unknown): { valid: boolean; normalizedUrl?: string; error?: string } {
  try { return { valid: true, normalizedUrl: normalizeGitUrl(input) }; }
  catch (error) { return { valid: false, error: error instanceof Error ? error.message : "Invalid Git URL" }; }
}
export function supportsGitHubPush(input: unknown): boolean {
  try { return new URL(normalizeGitUrl(input)).hostname === "github.com"; } catch { return false; }
}
export function redactGitUrl(input: string | null | undefined): string {
  if (!input) return "";
  try { const url = new URL(input); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); } catch { return ""; }
}

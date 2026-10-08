// Allowlist deliberately excludes environment values, credentials, source proofs,
// commands and raw logs. Drafts are convenience data and never authorize deployment.
export type ChatDeploymentDraft = {
  projectName: string; customPort: string; internalPort: string; appDirectory: string;
  framework: string; dockerEnabled: boolean; projectUrl: string; routingMode: "port" | "https";
};
export function parseChatDeploymentDraft(value: unknown): ChatDeploymentDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const port = (p: unknown) => typeof p === "string" && (/^\d{1,5}$/.test(p) && Number(p) > 0 && Number(p) <= 65535 || p === "") ? p : "";
  let projectUrl = "";
  if (typeof v.projectUrl === "string") {
    try { const url = new URL(v.projectUrl); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/") projectUrl = url.origin; } catch { /* incomplete draft URL */ }
  }
  return {
    projectName: typeof v.projectName === "string" && /^[a-zA-Z0-9_-]{0,100}$/.test(v.projectName) ? v.projectName : "",
    customPort: port(v.customPort), internalPort: port(v.internalPort),
    appDirectory: typeof v.appDirectory === "string" && v.appDirectory.length <= 512 && !v.appDirectory.startsWith("/") && !v.appDirectory.split("/").includes("..") && !/[\\\x00-\x1f]/.test(v.appDirectory) ? v.appDirectory : ".",
    framework: typeof v.framework === "string" && /^[a-z0-9-]{1,64}$/.test(v.framework) ? v.framework : "auto",
    dockerEnabled: v.dockerEnabled !== false, projectUrl, routingMode: v.routingMode === "https" ? "https" : "port",
  };
}

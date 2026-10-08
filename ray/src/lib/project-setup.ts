import { FRAMEWORKS } from "./framework-registry";

/** Versioned setup contract shared by forms, deployment and project editing. */
export interface ProjectSetup {
  healthCheck: { type: "http" | "tcp"; path: string; timeoutSeconds: number; intervalSeconds: number; successStatus: number };
  routingMode: "port" | "https";
  version: 1;
  sourceRoot: string;
  appDirectory: string;
  framework: string;
  buildCommand: string;
  startCommand: string;
  hostPort: number | null;
  containerPort: number | null;
  projectUrl: string;
  dockerEnabled: boolean;
  envVars: Record<string, string>;
}
export function defaultProjectSetup(): ProjectSetup {
  return { healthCheck: { type: "http", path: "/", timeoutSeconds: 60, intervalSeconds: 2, successStatus: 0 }, routingMode: "port", version: 1, sourceRoot: "", appDirectory: ".", framework: "auto", buildCommand: "", startCommand: "", hostPort: null, containerPort: null, projectUrl: "", dockerEnabled: true, envVars: {} };
}
export function parseProjectSetup(input: unknown): ProjectSetup {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Project setup must be an object.");
  const value = input as Record<string, unknown>;
  if (value.version !== undefined && value.version !== 1) throw new Error("Unsupported setup version.");
  const result = defaultProjectSetup();
  for (const key of ["sourceRoot", "appDirectory", "framework", "buildCommand", "startCommand", "projectUrl"] as const) {
    const text = value[key] ?? result[key];
    if (typeof text !== "string" || text.length > 4096 || /[\x00-\x1f\x7f]/.test(text)) throw new Error(`Invalid ${key}. Use a single line of text.`);
    result[key] = text.trim();
  }
  result.appDirectory ||= ".";
  if (result.appDirectory.startsWith("/") || result.appDirectory.includes("\\") || result.appDirectory.split("/").includes("..") || /^[A-Za-z]:/.test(result.appDirectory)) throw new Error("Application directory must be inside the source root.");
  if (result.framework !== "auto" && !FRAMEWORKS.some(item => item.slug === result.framework)) throw new Error("Choose a supported framework or automatic detection.");
  for (const key of ["hostPort", "containerPort"] as const) {
    const port = value[key];
    if (port == null || port === "") continue;
    if (!((typeof port === "number" || typeof port === "string") && /^\d+$/.test(String(port)))) throw new Error(`Invalid ${key}.`);
    result[key] = Number(port);
    if (result[key]! < 1 || result[key]! > 65535) throw new Error("Ports must be between 1 and 65535.");
  }
  if (value.dockerEnabled !== undefined && typeof value.dockerEnabled !== "boolean") throw new Error("Invalid Docker option.");
  result.dockerEnabled = value.dockerEnabled !== false;
  if (result.projectUrl) {
    let url: URL;
    try { url = new URL(result.projectUrl); } catch { throw new Error("Application URL must include http:// or https://."); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Application URL must be HTTP or HTTPS without credentials.");
    result.projectUrl = url.toString();
  }
  const health = value.healthCheck ?? result.healthCheck;
  if (!health || typeof health !== "object" || Array.isArray(health)) throw new Error("Invalid health check.");
  const h = { ...result.healthCheck, ...health } as ProjectSetup["healthCheck"];
  if (!["http", "tcp"].includes(h.type) || typeof h.path !== "string" || !h.path.startsWith("/") || h.path.startsWith("//") || /[\x00-\x20\\#]/.test(h.path) || h.path.length > 2048) throw new Error("Health path must be a local path such as /health.");
  for (const [key, min, max] of [["timeoutSeconds", 5, 300], ["intervalSeconds", 1, 30], ["successStatus", 0, 499]] as const) {
    if (!Number.isInteger(h[key]) || h[key] < min || h[key] > max) throw new Error(`Invalid health check ${key}.`);
  }
  if (h.successStatus !== 0 && h.successStatus < 200) throw new Error("Expected status must be 200–499, or automatic.");
  result.healthCheck = h;
  if (value.routingMode !== undefined && value.routingMode !== "port" && value.routingMode !== "https") throw new Error("Invalid routing mode.");
  result.routingMode = value.routingMode === "https" ? "https" : "port";
  if (result.routingMode === "https") {
    let url: URL; try { url = new URL(result.projectUrl); } catch { throw new Error("Enter an HTTPS domain."); }
    if (url.protocol !== "https:" || url.port || url.pathname !== "/" || url.search || url.hash || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(url.hostname) || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) throw new Error("Use an HTTPS domain without a port, path, or query.");
    if (h.type === "tcp") throw new Error("Managed HTTPS routes HTTP applications. Choose an HTTP health check or direct port access for a TCP service.");
  }
  const env = value.envVars ?? {};
  if (!env || typeof env !== "object" || Array.isArray(env) || Object.keys(env).length > 200) throw new Error("Invalid environment variables.");
  result.envVars = Object.create(null);
  for (const [key, content] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof content !== "string" || content.includes("\0") || content.length > 65536) throw new Error(`Invalid environment variable: ${key}`);
    result.envVars[key] = content;
  }
  if (JSON.stringify(result).length > 256 * 1024) throw new Error("Project setup is too large.");
  return result;
}

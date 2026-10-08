/** Read saved runtime settings without silently discarding a malformed environment. */
export function parseDeploymentEnvironment(value: string | null | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("Saved environment variables are invalid. Update the deployment configuration before retrying."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      !Object.entries(parsed).every(([key, item]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof item === "string" && !item.includes("\0"))) {
    throw new Error("Environment variables must have valid names and string values.");
  }
  return parsed as Record<string, string>;
}

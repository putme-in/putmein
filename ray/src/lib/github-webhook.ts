import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

export function verifyGithubWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string | null | undefined
): boolean {
  if (!secret || !signature?.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const providedDigest = signature.slice(SIGNATURE_PREFIX.length);
  if (!/^[0-9a-fA-F]{64}$/.test(providedDigest)) {
    return false;
  }

  const expectedDigest = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const receivedDigest = Buffer.from(providedDigest, "hex");

  return receivedDigest.length === expectedDigest.length && timingSafeEqual(receivedDigest, expectedDigest);
}

/**
 * Validates that a Git branch name conforms to safe refspec rules:
 * - Must not be empty or exceed 250 characters
 * - Must only contain alphanumeric characters, dots, underscores, dashes, and slashes
 * - Must not start with a dash (-) or slash (/) to prevent command-line flag injection
 * - Must not end with a slash (/) or ".lock"
 * - Must not contain ".." or "@{" or consecutive slashes "//"
 */
export function isValidGitBranch(branch: string | null | undefined): boolean {
  if (!branch || typeof branch !== "string") return false;
  const trimmed = branch.trim();
  if (!trimmed || trimmed.length > 250) return false;
  if (trimmed.startsWith("-") || trimmed.startsWith("/")) return false;
  if (trimmed.endsWith("/") || trimmed.endsWith(".lock")) return false;
  if (trimmed.includes("..") || trimmed.includes("@{") || trimmed.includes("//")) return false;
  return /^[a-zA-Z0-9._\-\/]+$/.test(trimmed);
}


import "server-only";
import { createHash } from "crypto";

export function hostRuntimeHandle(userId: string, projectId: string) {
  return `process:${createHash("sha256").update(`${userId}\0${projectId}`).digest("hex")}`;
}
export function requireStoppedRuntime(previous: { containerName: string | null; status: string } | null, dockerEnabled: boolean) {
  if (!previous?.containerName) return;
  const wasHost = previous.containerName.startsWith("process:");
  if (wasHost === dockerEnabled && previous.status !== "stopped") {
    throw new Error("Stop the current deployment before switching between Docker and host execution.");
  }
}

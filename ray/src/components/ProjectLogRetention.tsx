"use client";

import { useState } from "react";
import type { LogPreview } from "@/lib/log-retention";

export default function ProjectLogRetention({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<LogPreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function perform(action: "preview" | "clear") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/log-retention`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, items: items?.map(({ kind, id, fingerprint }) => ({ kind, id, fingerprint })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Log cleanup failed");
      if (action === "preview") {
        setItems(data.items);
        const notice = data.manualReview ? ` ${data.manualReview} records have an unsupported stage format and need manual review.` : "";
        setMessage((data.items.length
          ? "Review this batch before clearing its log text. This cannot be undone."
          : "No eligible logs found in this batch.") + notice);
      } else {
        setItems(null);
        setMessage(`Cleared logs from ${data.cleared} records. ${data.skipped} changed or protected records were skipped. Preview again to check for another batch.`);
      }
    } catch (error) {
      setItems(null);
      setMessage(error instanceof Error ? error.message : "Log cleanup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ray-card p-5 mt-4">
      <h2 className="font-sans font-bold text-lg text-white mb-1">Deployment log history</h2>
      <p className="text-xs text-white/50 mb-4">
        Clear old build and CI/CD log text while keeping deployment records, commits, durations and stage results.
        Keeps healthy deployments, active runs, the newest ten records of each kind and anything under 30 days old.
        Save any logs you need before clearing them.
      </p>
      <button type="button" className="ray-btn-ghost text-xs" disabled={busy} onClick={() => perform("preview")}>
        Preview old logs
      </button>
      {items && items.length > 0 && (
        <div className="mt-4">
          <ul className="text-xs text-white/60 space-y-2 max-h-48 overflow-auto">
            {items.map(item => (
              <li key={`${item.kind}:${item.id}`}>
                {item.kind === "deployment" ? "Deployment" : "CI/CD"} · {item.name} · {new Date(item.createdAt).toLocaleDateString()}
                {" · "}{(item.bytes / 1024).toFixed(1)} KB
              </li>
            ))}
          </ul>
          <p className="text-xs text-white/40 mt-3">Up to 50 records of each kind per batch. Runtime files and security reports are preserved.</p>
          <button type="button" className="ray-btn-ghost text-xs mt-3" disabled={busy} onClick={() => perform("clear")}>
            Permanently clear listed log text
          </button>
        </div>
      )}
      {(busy || message) && <p role="status" className="text-xs text-white/70 mt-3">{busy ? "Working…" : message}</p>}
    </section>
  );
}

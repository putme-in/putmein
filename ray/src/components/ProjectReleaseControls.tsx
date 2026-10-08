"use client";

import { useState } from "react";

type CleanupItem = {
  path: string;
  kind: string;
  bytes: number;
  removed?: boolean;
  error?: string;
};

export default function ProjectReleaseControls({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<CleanupItem[] | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function action(name: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/releases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: name,
          paths: items?.filter(item => !item.error).map(item => item.path),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Operation failed");
      if (name === "preview") {
        setItems(data.items);
        setMessage(data.items.length
          ? "Only the listed eligible artifacts will be removed. Active, previous and recent releases are preserved."
          : "No tracked releases are eligible for cleanup.");
      } else {
        setConfirm(false);
        if (name === "cleanup") {
          const results: CleanupItem[] = data.items || [];
          setItems(results.filter(item => item.error));
          setMessage(`Cleanup finished: ${results.filter(item => item.removed).length} source folders removed. ${results.filter(item => item.error).length} preserved due to errors.`);
        } else {
          setItems(null);
          setMessage("Operation completed. Refresh the project to see the restored runtime.");
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ray-card p-5 mt-4">
      <h2 className="font-sans font-bold text-lg text-white mb-1">Release recovery and cleanup</h2>
      <p className="text-xs text-white/50 mb-4">
        Restore the previous retained release without rebuilding it. Security checks still apply.
        Same-port replacement can briefly interrupt traffic; database changes and external side effects cannot be rolled back.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ray-btn-ghost text-xs" disabled={busy} onClick={() => setConfirm(!confirm)}>
          Restore previous release
        </button>
        <button type="button" className="ray-btn-ghost text-xs" disabled={busy} onClick={() => action("recover")}>
          Recover interrupted deployment
        </button>
        <button type="button" className="ray-btn-ghost text-xs" disabled={busy} onClick={() => action("preview")}>
          Preview cleanup
        </button>
      </div>
      {confirm && (
        <div className="mt-3">
          <p className="text-xs text-amber-400 mb-2">The running release will be replaced by the last retained version. Continue?</p>
          <button type="button" className="ray-btn-primary text-xs" disabled={busy} onClick={() => action("rollback")}>
            Restore release
          </button>
        </div>
      )}
      {items && items.length > 0 && (
        <div className="mt-4">
          <ul className="text-xs text-white/60 space-y-2 max-h-48 overflow-auto">
            {items.map(item => (
              <li key={item.path} className="break-all">
                {item.path} · {(item.bytes / 1048576).toFixed(1)} MB {item.error && `— ${item.error}`}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="ray-btn-ghost text-xs mt-3"
            disabled={busy || items.every(item => Boolean(item.error))}
            onClick={() => action("cleanup")}
          >
            Remove eligible listed artifacts
          </button>
        </div>
      )}
      <p className="text-xs text-white/40 mt-3">
        Keeps at least the three newest tracked releases and anything newer than seven days.
        Existing untracked uploads and Git checkouts are never swept automatically.
        New Docker logs rotate at 10 MB × 3 files. New host starts retain three 10 MiB log segments; retired host logs expire after seven days.
      </p>
      {(busy || message) && <p role="status" className="text-xs text-white/70 mt-3">{busy ? "Operation in progress…" : message}</p>}
    </section>
  );
}

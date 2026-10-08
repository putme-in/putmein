"use client";
import { useEffect, useState } from "react";

type Item = { id: string; kind: string; path: string; owner: string; project: string; bytes: number; modified: string; fingerprint: string; eligible: boolean; reason: string; state: string };
export default function LegacyArtifactReview() {
  const [available, setAvailable] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<{ item: Item; action: string } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/maintenance/legacy-artifacts", { signal: abort.signal }).then(r => r.json()).then(data => setAvailable(data.available === true)).catch(() => {});
    return () => abort.abort();
  }, []);
  async function perform(action: string, item?: Item) {
    setBusy(true); setMessage(""); setConfirmation(null);
    try {
      const response = await fetch("/api/maintenance/legacy-artifacts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, items: item ? [{ id: item.id, fingerprint: item.fingerprint }] : undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Legacy review failed");
      if (action === "preview") {
        setItems(data.items);
        setMessage(data.items.length ? "Review ownership and protection reasons before choosing an action." : "No legacy staging folders or matching Docker resources were found.");
      } else {
        setItems(null);
        const result = data.results?.[0];
        setMessage(result?.error || "Action completed. Run review again to refresh ownership, references and eligible actions.");
      }
    } catch (error) {
      setItems(null);
      setMessage(error instanceof Error ? error.message : "Legacy operation failed");
    } finally { setBusy(false); }
  }
  if (!available) return null;
  return <section className="ray-card p-5 mt-4">
    <h2 className="font-sans font-bold text-lg text-white mb-1">Server legacy artifacts</h2>
    <p className="text-xs text-white/50 mb-4">Administrator review across all projects. Unknown ownership, active references and recent changes prevent cleanup. Source folders move to reversible quarantine first; permanent removal waits seven days.</p>
    <button type="button" className="ray-btn-ghost text-xs" disabled={busy} onClick={() => perform("preview")}>Review legacy artifacts</button>
    {items && <div className="mt-4 divide-y divide-white/10 max-h-[32rem] overflow-auto">
      {items.map((item, index) => <div key={`${item.kind}:${item.id}:${index}`} className="py-3 space-y-2">
        <p className="text-xs text-white/80 break-all">{item.kind} · {item.path || item.id}</p>
        {item.owner && <p className="text-xs text-white/40 break-all">Owner: {item.owner} · Project: {item.project || "unknown"} · {(item.bytes / 1048576).toFixed(1)} MiB of source files</p>}
        <p className={`text-xs ${item.eligible ? "text-amber-300" : "text-white/50"}`}>{item.reason}</p>
        <div className="flex gap-2">
          {item.kind === "source" && item.eligible && <button type="button" className="ray-btn-ghost text-xs" disabled={busy} onClick={() => perform("quarantine", item)}>Quarantine folder</button>}
          {item.kind === "quarantine" && item.fingerprint && <button type="button" className="ray-btn-ghost text-xs" disabled={busy} onClick={() => perform("restore", item)}>Restore original location</button>}
          {item.eligible && ["quarantine", "container", "image"].includes(item.kind) &&
            <button type="button" className="ray-btn-ghost text-xs" disabled={busy} onClick={() => setConfirmation({ item, action: item.kind === "quarantine" ? "delete-quarantine" : "remove-docker" })}>Permanently remove {item.kind === "quarantine" ? "quarantined folder" : item.kind}</button>}
        </div>
      </div>)}
    </div>}
    {confirmation && <div className="mt-4 text-xs text-amber-300">
      <p className="break-all">Permanently remove {confirmation.item.path}? This cannot be undone. Docker volumes and networks are preserved.</p>
      <div className="flex gap-2 mt-2">
        <button type="button" className="ray-btn-ghost text-xs" disabled={busy} onClick={() => perform(confirmation.action, confirmation.item)}>Confirm permanent removal</button>
        <button type="button" className="ray-btn-ghost text-xs" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button>
      </div>
    </div>}
    <p className="text-xs text-white/40 mt-3">Only known staging areas are eligible. Review-only items require manual investigation. Quarantine and deletion require Docker mount inspection and an available lsof open-file check. Avoid concurrent manual changes during maintenance.</p>
    {(busy || message) && <p role="status" className="text-xs text-white/70 mt-3">{busy ? "Inspecting artifacts and their references…" : message}</p>}
  </section>;
}

"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { type Incident, type IncidentState } from "@/lib/incidents";
type Overview = { items: Incident[]; counts: Record<string, number>; truncated: boolean };
export default function DashboardIncidents({ expanded = false }: { expanded?: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState("active");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(0);
  const generation = useRef(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    const request = ++generation.current;
    try {
      const response = await fetch("/api/dashboard/incidents", { cache: "no-store", signal });
      if (!response.ok) throw new Error("Could not refresh incidents. Previous results may be outdated.");
      const next = await response.json();
      if (!signal?.aborted && request === generation.current) { setData(next); setError(""); }
    } catch (e) { if (!signal?.aborted && request === generation.current) setError(e instanceof Error ? e.message : "Could not load incidents"); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => { if (!document.hidden) void load(controller.signal); }, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load]);
  async function update(item: Incident, next: IncidentState) {
    setBusy(item.id); ++generation.current;
    try {
      const response = await fetch("/api/dashboard/incidents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: item.kind, sourceId: item.sourceId, fingerprint: item.fingerprint, revision: item.revision, state: next }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update incident");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update incident"); }
    finally { setBusy(null); }
  }
  const filtered = useMemo(() => (data?.items || []).filter(item => (kind === "all" || item.kind === kind) && (state === "all" || (state === "active" ? item.state !== "dismissed" : item.state === state))), [data, state, kind]);
  const size = expanded ? 25 : 8;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / size) - 1));
  const visible = filtered.slice(currentPage * size, (currentPage + 1) * size);
  return <section className="ray-card p-5 mb-7" aria-labelledby="incident-heading">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <h2 id="incident-heading" className="font-sans text-lg font-bold text-white">Needs attention{data && ` · ${data.counts.open + data.counts.acknowledged}`}</h2>
      <div className="flex gap-3 text-xs"><button className="ray-btn-ghost" onClick={() => void load()}>Refresh</button>{!expanded && <Link className="ray-btn-ghost" href="/incidents">Open incidents</Link>}</div>
    </div>
    <p className="text-xs text-white/50 mb-3">Runtime alerts, failed deployment attempts and security scan findings. Handling an incident records your review; it does not fix the source or approve security risks.</p>
    {error && <p role="alert" className="text-xs text-red-400 mb-3">{error}</p>}
    {!data && !error && <p role="status" className="text-xs text-white/50">Loading incidents…</p>}
    <div className="flex flex-wrap gap-3 text-xs text-white/70 mb-3">
      <label>Source <select className="ray-input text-xs" value={kind} onChange={e => { setKind(e.target.value); setPage(0); }}>{["all", "runtime", "deployment", "security"].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>State <select className="ray-input text-xs" value={state} onChange={e => { setState(e.target.value); setPage(0); }}>{["active", "open", "acknowledged", "dismissed", "all"].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>
    {data && <p className="text-xs text-white/50 mb-3">{data.counts.open} open · {data.counts.acknowledged} acknowledged · {data.counts.dismissed} dismissed</p>}
    {data?.truncated && <p role="status" className="text-xs text-amber-300 mb-3">This view is limited to the newest 300 records per source. Counts cover this inventory only; older records remain in their source pages.</p>}
    {data && !filtered.length && <p className="text-sm text-white/60">No incidents match this view.</p>}
    <div className="divide-y divide-white/10">{visible.map(item => <div key={item.id} className="py-3 space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <span className={`text-xs uppercase ${["critical", "error", "vulnerable"].includes(item.severity) ? "text-red-400" : "text-amber-300"}`}>{item.severity}</span>
        <div className="flex-1 min-w-0"><p className="text-sm text-white break-words">{item.title}</p><p className="text-xs text-white/40 mt-1">{item.projectName} · {item.kind} · {item.state} · {new Date(item.createdAt).toLocaleString()}</p></div>
        <Link href={item.href} className="ray-btn-ghost text-xs">Investigate</Link>
        {item.state === "open" && <button className="ray-btn-ghost text-xs" disabled={busy !== null} onClick={() => void update(item, "acknowledged")}>Acknowledge</button>}
        {item.state !== "dismissed" && <button className="ray-btn-ghost text-xs" disabled={busy !== null} onClick={() => void update(item, "dismissed")}>Dismiss</button>}
        {item.state !== "open" && <button className="ray-btn-ghost text-xs" disabled={busy !== null} onClick={() => void update(item, "open")}>Reopen</button>}
      </div>
      {item.history.length > 0 && <details className="text-xs text-white/50"><summary className="cursor-pointer">Handling history (latest 20)</summary><ul className="mt-2 space-y-1">{item.history.map((event, index) => <li key={index}>{new Date(event.at).toLocaleString()} · {event.state}</li>)}</ul></details>}
    </div>)}</div>
    {filtered.length > size && <div className="flex gap-3 items-center mt-3 text-xs text-white/50"><button className="ray-btn-ghost" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {Math.ceil(filtered.length / size)}</span><button className="ray-btn-ghost" disabled={(currentPage + 1) * size >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next</button></div>}
  </section>;
}

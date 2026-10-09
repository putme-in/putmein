"use client";
import { useEffect, useState } from "react";
import { liveAddresses } from "@/lib/live-addresses";
export default function LiveAppLinks({ url, expanded = false, label = "Open live app" }: { url: string; expanded?: boolean; label?: string }) {
  const [open, setOpen] = useState(expanded);
  const [ips, setIps] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/server/addresses", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Could not discover server addresses.");
      const data = await response.json();
      setIps([data.localIp, data.publicIp].filter((value): value is string => typeof value === "string"));
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open]);
  return <div className="min-w-0">
    {!expanded && <button type="button" className="ray-btn-primary text-xs px-3 py-2" aria-expanded={open} onClick={() => setOpen(!open)}>{label}</button>}
    {open && <div className="mt-3 space-y-2 rounded-xl border border-white/10 p-3 text-xs">
      <p className="text-white/60">Choose an address</p>
      {liveAddresses(url, ips).map(link => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="block rounded-lg p-2 hover:bg-white/5 focus-visible:outline focus-visible:outline-white"><span className="font-medium text-white">{link.label}</span><span className="block break-all text-white/70 mt-1">{link.url}</span>{link.note && <span className="block text-white/40 mt-1">{link.note}</span>}</a>)}
      {loading && <p role="status" className="text-white/40">Finding server addresses…</p>}
      {error && <p role="status" className="text-amber-300">{error}</p>}
    </div>}
  </div>;
}

"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
interface Connection { id: string; name: string; repoUrl: string; username: string; private: boolean }
const blank = { name: "", repoUrl: "", username: "", token: "", private: true };
export default function GitConnections({ manage = false }: { manage?: boolean }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function load() {
    try { const response = await fetch("/api/git/connections", { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setConnections(data.connections); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not load Git sources."); }
  }
  useEffect(() => { void load(); }, []);
  return <section id="git-connections" className="ray-card p-6 mb-6">
    <div className="flex items-center justify-between gap-3 mb-3"><h2 className="font-sans font-semibold text-lg text-white">Git sources</h2>
      {!manage && <Link className="ray-btn-ghost text-xs" href="/settings#git-connections">Manage sources</Link>}</div>
    <p className="text-xs text-white/50 mb-4">Add public or private HTTPS repositories from GitLab, Bitbucket, GitHub or your own Git server. Private sources use a repository-scoped username and access token. Your existing GitHub account integration remains available.</p>
    <div className="divide-y divide-white/10">{connections.map(connection => <div key={connection.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><p className="text-sm text-white">{connection.name} <span className="text-xs text-white/40">· {connection.private ? "Private" : "Public"}</span></p><p className="text-xs text-white/40 break-all">{connection.repoUrl}</p></div>
      <div className="flex gap-2"><Link href={`/deployments/new?repo=${encodeURIComponent(connection.repoUrl)}`} className="ray-btn-ghost text-xs">Set up deployment</Link>
        {manage && <><button type="button" disabled={busy} className="ray-btn-ghost text-xs" onClick={() => { setForm({ ...connection, token: "" }); setEditing(true); setMessage(""); }}>Edit</button>
        <button type="button" disabled={busy} className="ray-btn-ghost text-xs text-red-400" onClick={async () => {
          setBusy(true); setMessage("");
          try { const response = await fetch("/api/git/connections", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: connection.id }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); await load(); setMessage("Connection removed. Existing apps keep running; future private Git fetches need credentials."); }
          catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove connection."); } finally { setBusy(false); }
        }}>Remove</button></>}
      </div></div>)}</div>
    {!connections.length && <p className="text-xs text-white/40 mb-3">No saved Git sources yet. Public repositories can also be entered directly during deployment setup.</p>}
    {manage && <form className="mt-4 flex flex-col gap-3" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setMessage("");
      try { const response = await fetch("/api/git/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setForm(blank); setEditing(false); await load(); setMessage("Saved. Prepare the repository to verify access; saving does not deploy it."); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Could not save connection."); } finally { setBusy(false); }
    }}><fieldset disabled={busy} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-white">{editing ? "Edit source / rotate credentials" : "Add Git source"}</h3>
      <label className="text-xs text-white/60">Connection name<input className="ray-input mt-1" required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <label className="text-xs text-white/60">HTTPS clone URL<input type="url" className="ray-input mt-1" required readOnly={editing} value={form.repoUrl} placeholder="https://git.example.com/team/app.git" onChange={e => setForm({ ...form, repoUrl: e.target.value })} /></label>
      <label className="flex items-center gap-2 text-xs text-white/70"><input type="checkbox" checked={form.private} onChange={e => setForm({ ...form, private: e.target.checked, token: "" })} />Private repository / authentication required</label>
      {form.private && <><label className="text-xs text-white/60">Git username<input className="ray-input mt-1" required autoComplete="off" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></label>
      <label className="text-xs text-white/60">Access token or password<input type="password" className="ray-input mt-1" required={!editing} autoComplete="new-password" value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} placeholder={editing ? "Leave blank to keep current token" : "Repository read access"} /></label>
      <p className="text-xs text-white/40">Use the username and token required by your Git provider. Credentials are encrypted on the server and never shown again. Rotation applies to future fetches of this exact repository.</p></>}
      <p className="text-xs text-white/40">HTTPS only; SSH keys, submodules and Git LFS downloads are not supported here. External sources can be updated using Run pipeline; automatic push triggers currently use the GitHub integration.</p>
      <div className="flex gap-2"><button className="ray-btn-primary text-xs" type="submit">{busy ? "Saving…" : "Save source"}</button>{editing && <button className="ray-btn-ghost text-xs" type="button" onClick={() => { setEditing(false); setForm(blank); }}>Cancel</button>}</div>
    </fieldset></form>}
    {message && <p role="status" className="text-xs text-white/70 mt-3">{message}</p>}
  </section>;
}

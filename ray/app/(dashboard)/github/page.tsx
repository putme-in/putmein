"use client";

import GitConnections from "@/components/GitConnections";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  description: string;
  isPrivate: boolean;
  language: string;
  defaultBranch: string;
  updatedAt: string;
  stars: number;
}

const SpinIcon = ({ size = 14 }: { size?: number }) => (
  <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

export default function GitHubPage() {
  const router = useRouter();
  const [status, setStatus] = useState<{ connected: boolean; integration?: any }>({ connected: false });
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const fetchStatusAndRepos = useCallback(async () => {
    try {
      const sRes = await fetch("/api/github/status");
      if (sRes.ok) {
        const sData = await sRes.json();
        setStatus(sData);
        if (sData.connected) {
          const rRes = await fetch("/api/github/repos");
          if (rRes.ok) {
            const rData = await rRes.json();
            setRepos(rData.repos || []);
          }
        }
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchStatusAndRepos();
  }, [fetchStatusAndRepos]);

  // 1-click GitHub App creation
  const handleCoolifyAppSetup = async () => {
    setManifestLoading(true);
    try {
      const res = await fetch("/api/github/app/manifest");
      if (!res.ok) throw new Error("Failed to get manifest");
      const data = await res.json();

      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.actionUrl || "https://github.com/settings/apps/new";
      form.target = "_self";

      const manifestInput = document.createElement("input");
      manifestInput.type = "hidden";
      manifestInput.name = "manifest";
      manifestInput.value = data.manifest;
      form.appendChild(manifestInput);

      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      console.error(err);
      setShowManualModal(true);
    } finally {
      setManifestLoading(false);
    }
  };

  const handleConnectManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput) return;
    setConnecting(true);
    try {
      const res = await fetch("/api/github/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenInput }),
      });
      if (res.ok) {
        setShowManualModal(false);
        setTokenInput("");
        fetchStatusAndRepos();
      }
    } catch { /* silent */ }
    finally { setConnecting(false); }
  };

  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect GitHub?")) return;
    try {
      await fetch("/api/github/connect", { method: "DELETE" });
      setStatus({ connected: false });
      setRepos([]);
    } catch { /* silent */ }
  };

  const handleCopy = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const filteredRepos = repos.filter((r) =>
    r.fullName.toLowerCase().includes(search.toLowerCase()) ||
    (r.description && r.description.toLowerCase().includes(search.toLowerCase())) ||
    (r.language && r.language.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-jersey text-3xl text-white tracking-wide">Git repositories</h1>
          <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
            Connect GitHub or add an HTTPS Git source, then review setup before deployment.
          </p>
        </div>
        {status.connected ? (
          <button
            onClick={handleDisconnect}
            className="text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            style={{ color: "#ef4444", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            Disconnect Account
          </button>
        ) : (
          <button
            onClick={handleCoolifyAppSetup}
            disabled={manifestLoading}
            className="ray-btn-primary flex items-center gap-2 text-xs px-4 py-2 cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            {manifestLoading ? "Connecting…" : "Add GitHub Account (1-Click App)"}
          </button>
        )}
      </div>

      <GitConnections />
      {loading ? (
        <div className="flex items-center justify-center py-24 gap-2" style={{ color: "rgba(255,255,255,0.4)" }}>
          <SpinIcon /><span className="text-xs">Loading GitHub repositories…</span>
        </div>
      ) : !status.connected ? (
        /* Not Connected View */
        <div className="ray-card p-10 flex flex-col items-center justify-center text-center max-w-xl mx-auto" style={{ background: "#080808" }}>
          <div className="w-14 h-14 rounded-2xl mb-4 flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-white">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </div>
          <h2 className="font-jersey text-2xl text-white mb-2">Connect your GitHub Account</h2>
          <p className="text-xs mb-6 max-w-md" style={{ color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
            Authorize Ray directly on GitHub with 1 click to browse your repositories, trigger auto-deployments on git push, and link context in AI chat.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCoolifyAppSetup}
              disabled={manifestLoading}
              className="ray-btn-primary flex items-center gap-2 text-xs px-5 py-2.5 cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              {manifestLoading ? "Opening GitHub…" : "Add GitHub Account (1-Click App)"}
            </button>
            <button
              onClick={() => setShowManualModal(true)}
              className="ray-btn-ghost text-xs px-4 py-2.5 cursor-pointer"
            >
              Use Token
            </button>
          </div>
        </div>
      ) : (
        /* Connected View */
        <div className="flex flex-col gap-6">
          {/* Account Profile Banner */}
          <div
            className="ray-card p-4 rounded-xl flex items-center justify-between gap-4"
            style={{ background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center font-bold text-sm text-white overflow-hidden flex-shrink-0">
                {status.integration?.avatarUrl ? (
                  <img src={status.integration.avatarUrl} alt="Avatar" className="w-10 h-10 rounded-full" />
                ) : (
                  status.integration?.githubUsername?.[0]?.toUpperCase() || "G"
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-white">{status.integration?.githubUsername || "GitHub Account"}</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Connected App
                  </span>
                </div>
                <p className="text-[11px] font-mono text-white/40 mt-0.5">
                  {repos.length} Repositories Available · Auto CI/CD Active
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowManualModal(true)}
                className="ray-btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 cursor-pointer text-white/70"
                title="Add Personal Access Token for Private Repositories & Non-interactive Clones"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
                <span>Add Private Repo Token</span>
              </button>

              <button
                onClick={fetchStatusAndRepos}
                className="ray-btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 cursor-pointer"
                title="Refresh Repositories"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Search & Stats Bar */}
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search repositories by name or language…"
                className="ray-input w-full text-xs"
                style={{ paddingLeft: "2.4rem" }}
              />
            </div>
            <span className="text-xs text-white/40 font-mono">
              Showing {filteredRepos.length} of {repos.length} repositories
            </span>
          </div>

          {/* Repository Cards Grid */}
          {filteredRepos.length === 0 ? (
            <div className="ray-card p-12 text-center text-xs text-white/35" style={{ background: "#080808" }}>
              No repositories match &quot;{search}&quot;.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredRepos.map((repo) => (
                <div
                  key={repo.id}
                  className="ray-card p-4 rounded-xl flex flex-col justify-between gap-3 transition-all duration-150 hover:border-white/20"
                  style={{ background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-white/60 flex-shrink-0">
                          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                        </svg>
                        <span className="font-mono text-xs font-semibold text-white truncate">
                          {repo.fullName}
                        </span>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-mono font-bold tracking-wider"
                        style={{
                          background: repo.isPrivate ? "rgba(234,179,8,0.1)" : "rgba(255,255,255,0.06)",
                          color: repo.isPrivate ? "#eab308" : "rgba(255,255,255,0.6)",
                        }}>
                        {repo.isPrivate ? "Private" : "Public"}
                      </span>
                    </div>

                    <p className="text-xs text-white/40 line-clamp-2 mb-2.5 min-h-[32px]">
                      {repo.description || "No description provided."}
                    </p>

                    <div className="flex items-center gap-3 text-[11px] text-white/35 font-mono">
                      {repo.language && (
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-sky-400" />
                          {repo.language}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                        {repo.defaultBranch}
                      </span>
                      {repo.stars > 0 && (
                        <span>★ {repo.stars}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.04]">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/deployments/new?repo=${encodeURIComponent(repo.cloneUrl || repo.htmlUrl)}&branch=${encodeURIComponent(repo.defaultBranch || "")}`}
                        className="ray-btn-ghost text-[11px] px-2.5 py-1 flex items-center gap-1.5 cursor-pointer"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                        <span>Set up deployment</span>
                      </Link>

                      <button
                        type="button"
                        onClick={() => handleCopy(repo.cloneUrl || repo.htmlUrl)}
                        className="ray-btn-ghost text-[11px] px-2.5 py-1 flex items-center gap-1 cursor-pointer"
                        title="Copy Clone URL"
                      >
                        {copiedUrl === (repo.cloneUrl || repo.htmlUrl) ? "Copied!" : "Copy URL"}
                      </button>
                    </div>

                    <a
                      href={repo.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/40 hover:text-white text-[11px] flex items-center gap-1 cursor-pointer font-mono"
                    >
                      <span>GitHub</span>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Manual Modal Fallback */}
      {showManualModal && (
        <div
          className="fixed inset-0 z-[200] w-screen h-screen flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowManualModal(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl p-6" style={{ background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 20px 60px rgba(0,0,0,0.95)" }}>
            <h3 className="font-jersey text-2xl text-white mb-1">Connect GitHub with Token</h3>
            <p className="text-xs mb-4" style={{ color: "rgba(255,255,255,0.4)" }}>
              Enter your GitHub Personal Access Token with repo permissions.
            </p>

            <form onSubmit={handleConnectManual} className="flex flex-col gap-3.5">
              <div>
                <label className="ray-eyebrow mb-1 block">GitHub Token</label>
                <input
                  type="password"
                  required
                  placeholder="ghp_… or github_pat_…"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="ray-input w-full text-xs font-mono"
                />
              </div>

              <div className="flex gap-2.5 mt-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="ray-btn-ghost flex-1 text-xs py-2 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={connecting}
                  className="ray-btn-primary flex-1 text-xs py-2 cursor-pointer"
                >
                  {connecting ? "Connecting…" : "Connect"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

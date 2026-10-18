"use client";

import React, { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import CursorGlow from "@/components/CursorGlow";
import {
  Terminal,
  Copy,
  Check,
  Download,
  Shield,
  Cpu,
  Server,
  Layers,
  ExternalLink,
  Code2,
} from "lucide-react";

export default function DownloadPage() {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-green-500/30 overflow-x-hidden">
      <CursorGlow />
      <Navbar />

      <main className="relative pt-[140px] pb-24 px-4 sm:px-6 md:px-12 max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h1 className="pixel-font text-4xl sm:text-5xl md:text-6xl font-bold text-white tracking-tight mb-4">
            Download & Install PutmeIn
          </h1>
          <p className="text-zinc-400 text-base sm:text-lg font-light leading-relaxed">
            Deploy our autonomous SRE agent and management dashboard on your bare-metal server, cloud VPS, or local development workstation in seconds.
          </p>
        </div>

        {/* Primary Installation Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-16">
          {/* Card 1: Linux & macOS */}
          <div className="group relative bg-zinc-900/40 backdrop-blur-md border border-white/10 hover:border-white/20 rounded-2xl p-6 sm:p-8 transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-4 mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-green-400">
                    <Terminal className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-white">macOS & Linux</h2>
                    <p className="text-xs font-mono text-zinc-400">Bash / POSIX One-Liner</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 text-[11px] font-mono rounded-full bg-green-500/10 border border-green-500/30 text-green-400">
                  Recommended
                </span>
              </div>

              <p className="text-sm text-zinc-300 font-light mb-5">
                Installs Docker Engine, Node.js LTS, PM2, persistent local MySQL, and starts PutmeIn daemonized under PM2.
              </p>

              {/* Command Bar */}
              <div
                onClick={() =>
                  handleCopy("curl -fsSL https://putme.in/install.sh | bash", "unix")
                }
                className="relative flex items-center justify-between gap-3 p-3.5 bg-black/60 border border-white/10 rounded-xl cursor-pointer hover:border-white/25 transition-all mb-4"
              >
                <div className="flex items-center gap-2.5 overflow-x-auto min-w-0">
                  <span className="text-zinc-500 font-mono text-xs select-none flex-shrink-0">$</span>
                  <code className="text-[11.5px] sm:text-[13px] font-mono text-zinc-200 whitespace-nowrap select-all flex-shrink-0">
                    curl -fsSL https://putme.in/install.sh | bash
                  </code>
                </div>
                <button
                  type="button"
                  aria-label="Copy Command"
                  className="flex items-center gap-1 text-xs font-mono text-zinc-400 hover:text-white flex-shrink-0"
                >
                  {copiedId === "unix" ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>

              <div className="space-y-2 mb-6">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Check className="w-3.5 h-3.5 text-green-400" />
                  <span>Supports Ubuntu, Debian, Fedora, Arch, Alpine, AlmaLinux, CentOS</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Check className="w-3.5 h-3.5 text-green-400" />
                  <span>macOS Apple Silicon (M1/M2/M3/M4) & Intel (x86_64)</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Check className="w-3.5 h-3.5 text-green-400" />
                  <span>Full WSL2 & Git Bash compatibility on Windows</span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 flex items-center justify-between">
              <a
                href="/install.sh"
                download="install.sh"
                className="inline-flex items-center gap-2 text-xs font-mono text-zinc-300 hover:text-white hover:underline transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-green-400" />
                <span>Direct script download (install.sh)</span>
              </a>
              <span className="text-xs font-mono text-zinc-500">14 KB</span>
            </div>
          </div>

          {/* Card 2: Windows */}
          <div className="group relative bg-zinc-900/40 backdrop-blur-md border border-white/10 hover:border-white/20 rounded-2xl p-6 sm:p-8 transition-all flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-4 mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-blue-400">
                    <Server className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-white">Windows</h2>
                    <p className="text-xs font-mono text-zinc-400">PowerShell One-Liner</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 text-[11px] font-mono rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400">
                  Windows 10 / 11 / Server
                </span>
              </div>

              <p className="text-sm text-zinc-300 font-light mb-5">
                Native PowerShell script that configures Docker Desktop, Node.js LTS, local MySQL container, and PM2 service.
              </p>

              {/* Command Bar */}
              <div
                onClick={() =>
                  handleCopy('powershell -c "irm https://putme.in/install.ps1 | iex"', "win")
                }
                className="relative flex items-center justify-between gap-3 p-3.5 bg-black/60 border border-white/10 rounded-xl cursor-pointer hover:border-white/25 transition-all mb-4"
              >
                <div className="flex items-center gap-2.5 overflow-x-auto min-w-0">
                  <span className="text-zinc-500 font-mono text-xs select-none flex-shrink-0">CMD / PS&gt;</span>
                  <code className="text-[11.5px] sm:text-[13px] font-mono text-zinc-200 whitespace-nowrap select-all flex-shrink-0">
                    powershell -c &quot;irm https://putme.in/install.ps1 | iex&quot;
                  </code>
                </div>
                <button
                  type="button"
                  aria-label="Copy Command"
                  className="flex items-center gap-1 text-xs font-mono text-zinc-400 hover:text-white flex-shrink-0"
                >
                  {copiedId === "win" ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>

              <div className="space-y-2 mb-6">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Check className="w-3.5 h-3.5 text-blue-400" />
                  <span>Compatible with Windows PowerShell 5.1 & PowerShell 7 (pwsh)</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Check className="w-3.5 h-3.5 text-blue-400" />
                  <span>Auto-installs dependencies via Windows Package Manager (winget)</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Check className="w-3.5 h-3.5 text-blue-400" />
                  <span>Configures user environment under %USERPROFILE%\.putmein</span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 flex items-center justify-between">
              <a
                href="/install.ps1"
                download="install.ps1"
                className="inline-flex items-center gap-2 text-xs font-mono text-zinc-300 hover:text-white hover:underline transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-blue-400" />
                <span>Direct script download (install.ps1)</span>
              </a>
              <span className="text-xs font-mono text-zinc-500">8 KB</span>
            </div>
          </div>
        </div>

        {/* NPM Package Card */}
        <div className="bg-zinc-900/30 border border-white/10 rounded-2xl p-6 sm:p-8 mb-16">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                  <Code2 className="w-4 h-4" />
                </div>
                <h3 className="text-lg font-semibold text-white">Manual NPM Global Install</h3>
                <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-white/10 text-zinc-300">
                  npm
                </span>
              </div>
              <p className="text-sm text-zinc-400 font-light max-w-xl">
                Already have Node.js and Docker installed? Install the CLI package directly from the npmjs registry.
              </p>
            </div>

            <div className="w-full md:w-auto flex flex-col sm:flex-row items-center gap-3">
              <div
                onClick={() => handleCopy("npm install -g putmein", "npm")}
                className="w-full sm:w-auto flex items-center justify-between gap-4 px-4 py-2.5 bg-black/60 border border-white/15 rounded-xl cursor-pointer hover:border-white/30 transition-colors"
              >
                <code className="text-xs sm:text-sm font-mono text-zinc-200">
                  npm install -g putmein
                </code>
                {copiedId === "npm" ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4 text-zinc-400" />
                )}
              </div>

              <a
                href="https://www.npmjs.com/package/putmein"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-white/15 rounded-xl text-xs font-mono text-zinc-300 hover:text-white hover:bg-white/5 transition-colors"
              >
                <span>npmjs.com/package/putmein</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>

        {/* CLI Management Reference */}
        <div className="border border-white/10 rounded-2xl p-6 sm:p-8 bg-zinc-900/20">
          <div className="mb-6">
            <h3 className="text-lg sm:text-xl font-semibold text-white mb-1">
              CLI Management Reference
            </h3>
            <p className="text-sm text-zinc-400 font-light">
              Manage your PutmeIn daemon anytime using the global <code className="text-zinc-200 font-mono">ray</code> command:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                cmd: "ray",
                desc: "Start Ray & Brain in the background and display dashboard URLs.",
              },
              {
                cmd: "ray status",
                desc: "Check process status, CPU, memory consumption, and port health.",
              },
              {
                cmd: "ray logs",
                desc: "Stream live combined logs from both the Ray UI and Brain backend.",
              },
              {
                cmd: "ray stop",
                desc: "Gracefully stop all active PutmeIn background services.",
              },
              {
                cmd: "ray restart",
                desc: "Restart services and reload runtime environment settings.",
              },
              {
                cmd: "ray cohen",
                desc: "Launch the interactive terminal TUI management cockpit.",
              },
            ].map((item) => (
              <div
                key={item.cmd}
                className="p-4 rounded-xl bg-black/40 border border-white/5 flex flex-col justify-between"
              >
                <code className="text-xs font-mono text-green-400 font-semibold mb-1">
                  {item.cmd}
                </code>
                <p className="text-xs text-zinc-400 font-light leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

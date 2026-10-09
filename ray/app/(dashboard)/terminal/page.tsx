"use client";

import { useState, useEffect } from "react";
import TerminalView from "@/components/TerminalView";
import { Icon } from "@iconify/react";

export default function TerminalPage() {
  const [systemInfo, setSystemInfo] = useState<{
    os: string;
    hostname: string;
    username: string;
    defaultRoot: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/terminal/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "uname -srm 2>/dev/null || echo OS", cwd: "" }),
    })
      .then((res) => res.json())
      .then((data) => {
        setSystemInfo({
          os: data.stdout?.trim() || "Host Machine",
          hostname: data.host || "localhost",
          username: data.user || "user",
          defaultRoot: data.cwd || "~",
        });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#060606] px-6 py-6 font-sans space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.06] pb-4 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-jersey text-3xl text-white tracking-wide flex items-center gap-2">
              System Terminal
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Host Root
            </span>
          </div>
          <p className="text-xs text-[#52525b] mt-0.5">
            Direct system terminal access starting in your default user home directory. Completely isolated from repository codebases.
          </p>
        </div>

        {/* System Info Chips */}
        {systemInfo && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-card border border-card-border text-[11px] font-mono text-white/70 shadow-sm">
              <Icon icon="lucide:server" width={13} height={13} className="text-white/40" />
              <span>{systemInfo.hostname}</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-card border border-card-border text-[11px] font-mono text-white/70 shadow-sm">
              <Icon icon="lucide:user" width={13} height={13} className="text-white/40" />
              <span>{systemInfo.username}</span>
            </div>
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-xl bg-card border border-card-border text-[11px] font-mono text-white/50 shadow-sm">
              <Icon icon="lucide:cpu" width={13} height={13} className="text-white/40" />
              <span>{systemInfo.os}</span>
            </div>
          </div>
        )}
      </div>

      {/* Main Terminal Frame */}
      <div className="flex-1 min-h-0 flex flex-col">
        <TerminalView
          title="Host System Shell"
          initialCwd=""
          hasContainer={false}
        />
      </div>
    </div>
  );
}

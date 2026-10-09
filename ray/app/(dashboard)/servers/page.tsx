import Link from "next/link";
import { getLiveSystemStats } from "./[id]/actions";
import os from "os";

export default async function ServersPage() {
  const stats = await getLiveSystemStats();
  
  const server = {
    name: stats.name,
    ip: "127.0.0.1",
    status: "online",
    os: `${os.type()} ${os.release()}`,
    cpu: stats.cpu,
    memory: stats.memory,
    uptime: stats.uptime,
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mb-8 animate-fade-in">
        <h1 className="font-jersey text-4xl text-white tracking-wide mb-1">Servers</h1>
        <p className="text-sm text-[#52525b]">
          Monitor and manage your connected servers
        </p>
      </div>

      <div className="flex flex-col gap-3 animate-fade-in" style={{ animationDelay: "50ms" }}>
        <Link href="/servers/localhost" className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 rounded-xl">
          <div className="ray-card p-5 flex items-center gap-6 cursor-pointer group">
            {/* Status indicator */}
            <div className="flex items-center gap-3">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{
                  background: server.status === "online" ? "#0dd325" : "#ef4444",
                  boxShadow:
                    server.status === "online"
                      ? "0 0 8px rgba(13,211,37,0.5)"
                      : "none",
                }}
              />
            </div>

            {/* Server info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <span className="text-sm font-semibold text-white group-hover:opacity-80 transition-opacity">
                  {server.name}
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded"
                  style={{
                    background:
                      server.status === "online"
                        ? "rgba(13,211,37,0.1)"
                        : "rgba(239,68,68,0.1)",
                    color:
                      server.status === "online" ? "#0dd325" : "#f87171",
                  }}
                >
                  {server.status}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-[#52525b] font-mono">
                  {server.ip}
                </span>
                <span className="text-xs text-[#52525b]">{server.os}</span>
                <span className="text-xs text-[#52525b]">
                  ↑ {server.uptime}
                </span>
              </div>
            </div>

            {/* Mini stats */}
            <div className="flex items-center gap-6">
              {[
                { label: "CPU", value: server.cpu },
                { label: "MEM", value: server.memory },
              ].map((stat) => (
                <div key={stat.label} className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-[#52525b] uppercase tracking-wider">
                      {stat.label}
                    </span>
                    <span className="text-xs font-mono text-white">
                      {stat.value === null ? "N/A" : `${stat.value ?? 0}%`}
                    </span>
                  </div>
                  <div
                    className="w-16 h-1 rounded-full overflow-hidden"
                    style={{ background: "#1a1a1a" }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${stat.value === null ? "N/A" : `${stat.value ?? 0}%`}`,
                        background:
                          (stat.value ?? 0) < 60
                            ? "#0dd325"
                            : (stat.value ?? 0) < 80
                            ? "#eab308"
                            : "#ef4444",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}

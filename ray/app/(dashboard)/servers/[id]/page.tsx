import LiveMetrics from "./LiveMetrics";
import { getLiveSystemStats } from "./actions";

export default async function ServerPage() {
  const sysStats = await getLiveSystemStats();

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 sm:py-6">
      {/* Header */}
      <div className="mb-5 animate-fade-in">
        <h1 className="font-jersey text-3xl sm:text-4xl text-white tracking-wide mb-0.5">Server overview</h1>
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.65)" }}>
          {sysStats.name} — {sysStats.os}
        </p>
      </div>

      <LiveMetrics initialStats={sysStats} />
    </div>
  );
}

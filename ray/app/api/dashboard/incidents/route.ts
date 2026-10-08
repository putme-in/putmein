import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { loadIncidentSources } from "@/lib/incident-sources";
import { readIncidentState, updateIncidentState } from "@/lib/incident-store";
import { compareIncidents, incidentCounts, type IncidentKind } from "@/lib/incidents";
async function owner() { const token = (await cookies()).get("ray_token")?.value; return token ? await verifyToken(token) : null; }
export async function GET() {
  const user = await owner();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const sources = await loadIncidentSources(user.userId);
    const items = [];
    // Bound filesystem concurrency independently from inventory size.
    for (let start = 0; start < sources.items.length; start += 20) {
      items.push(...await Promise.all(sources.items.slice(start, start + 20).map(item => readIncidentState(user.userId, item))));
    }
    items.sort(compareIncidents);
    return NextResponse.json({ items, counts: incidentCounts(items), truncated: sources.truncated }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Incident overview is unavailable. No handling state was changed." }, { status: 503 }); }
}
export async function PATCH(req: Request) {
  const user = await owner();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !["runtime", "deployment", "security"].includes(body.kind) || typeof body.sourceId !== "string" || body.sourceId.length > 200 || !["open", "acknowledged", "dismissed"].includes(body.state) || !Number.isSafeInteger(body.revision) || body.revision < 0 || typeof body.fingerprint !== "string") return NextResponse.json({ error: "Invalid incident update" }, { status: 400 });
  try {
    const { items } = await loadIncidentSources(user.userId, { kind: body.kind as IncidentKind, id: body.sourceId });
    const item = items[0];
    if (!item) return NextResponse.json({ error: "Incident not found or source no longer requires review" }, { status: 404 });
    if (item.fingerprint !== body.fingerprint) return NextResponse.json({ error: "Source changed. Refresh and review again." }, { status: 409 });
    const updated = await updateIncidentState(user.userId, item, body.state, body.revision);
    return NextResponse.json({ item: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const conflict = (error as NodeJS.ErrnoException).code === "EEXIST" || (error as Error).message === "STALE";
    return NextResponse.json({ error: conflict ? "Another update is in progress or this view is stale. Refresh and retry." : "Could not save incident state" }, { status: conflict ? 409 : 503 });
  }
}

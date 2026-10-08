import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { listGitConnections, saveGitConnection, deleteGitConnection } from "@/lib/git-connections";
export const runtime = "nodejs";
async function owner() { const token = (await cookies()).get("ray_token")?.value; return token ? (await verifyToken(token))?.userId : null; }
export async function GET() {
  const userId = await owner();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ connections: await listGitConnections(userId) }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Could not load Git connections. Check storage permissions and the server authentication key." }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  const userId = await owner();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (Number(req.headers.get("content-length")) > 32768) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid connection.");
    return NextResponse.json({ connection: await saveGitConnection(userId, body) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save connection." }, { status: 400 }); }
}
export async function DELETE(req: NextRequest) {
  const userId = await owner();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { await deleteGitConnection(userId, (await req.json()).id); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ error: "Could not remove Git connection." }, { status: 400 }); }
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
async function proxy(req: Request) {
  const token = (await cookies()).get("ray_token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role?.toLowerCase() !== "admin") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  try {
    const body = req.method === "POST" ? await req.text() : undefined;
    if (body && body.length > 4096) return NextResponse.json({ error: "Settings too large" }, { status: 400 });
    const response = await fetch(`${process.env.BRAIN_URL || "http://localhost:4500"}/v1/security/advanced`, { method: req.method, headers: { "Content-Type": "application/json", "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" }, body, signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!response.ok) return NextResponse.json({ error: (await response.text()).slice(0, 1000) }, { status: response.status === 400 ? 400 : 503 });
    return NextResponse.json(await response.json(), { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Advanced security settings unavailable" }, { status: 503 }); }
}
export const GET = proxy;
export const POST = proxy;

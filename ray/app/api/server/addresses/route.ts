import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { detectServerIp } from "@/lib/network";
export async function GET() {
  const token = (await cookies()).get("ray_token")?.value;
  if (!token || !(await verifyToken(token))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const network = await detectServerIp();
    return NextResponse.json({ localIp: network.localIp, publicIp: network.isPubliclyExposed ? network.publicIp : null }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch { return NextResponse.json({ error: "Server addresses unavailable" }, { status: 503 }); }
}

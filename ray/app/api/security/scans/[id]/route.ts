import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get("ray_token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const scan = await prisma.raySecurityScan.findFirst({ where: { id, userId: user.userId } });
    if (!scan) return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    return NextResponse.json({ scan }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Could not load scan" }, { status: 503 }); }
}

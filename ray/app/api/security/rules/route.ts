import { NextResponse } from "next/server";

const BRAIN_URL = process.env.BRAIN_URL || "http://localhost:4500";

// GET /api/security/rules — retrieves active security checklist rules and known CVE registry
export async function GET() {
  try {
    const res = await fetch(`${BRAIN_URL}/v1/security/rules`, {
      signal: AbortSignal.timeout(4000),
      headers: { "x-brain-secret": process.env.BRAIN_INTERNAL_SECRET || "" },
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ rules: [], count: 0 });
  } catch (err: unknown) {
    console.error("GET /api/security/rules error:", err);
    return NextResponse.json({ rules: [], count: 0 });
  }
}

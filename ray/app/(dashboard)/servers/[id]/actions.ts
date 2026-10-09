"use server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { getSystemMetrics } from "@/lib/system-metrics";
export async function getLiveSystemStats() {
  const token = (await cookies()).get("ray_token")?.value;
  if (!token || !(await verifyToken(token))) throw new Error("Unauthorized");
  return getSystemMetrics();
}

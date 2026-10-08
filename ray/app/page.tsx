import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cookieStore = await cookies();
  const token = cookieStore.get("ray_token")?.value;

  if (token) {
    const user = await verifyToken(token);
    if (user) {
      redirect("/dashboard");
    }
  }

  // Check if initial admin setup is needed
  try {
    const admin = await prisma.user.findFirst({
      where: {
        role: "ADMIN",
        password: { not: "" },
      },
      select: { id: true },
    });

    if (!admin) {
      redirect("/setup");
    }
  } catch (error) {
    console.error("Home route setup check error:", error);
  }

  redirect("/login");
}

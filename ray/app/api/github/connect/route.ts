import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

// POST /api/github/connect — connect or update GitHub account
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { token: ghToken, username } = body;

    let githubUsername = username || "";
    let avatarUrl = "";

    // If token provided, verify with GitHub API
    if (ghToken) {
      try {
        const ghRes = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "Ray-Dashboard",
          },
        });
        if (ghRes.ok) {
          const ghUser = await ghRes.json();
          githubUsername = ghUser.login || githubUsername;
          avatarUrl = ghUser.avatar_url || "";
        }
      } catch { /* offline fallback */ }
    }

    if (!githubUsername) {
      githubUsername = "github-user";
    }
    if (!avatarUrl) {
      avatarUrl = `https://github.com/${githubUsername}.png`;
    }

    // Upsert integration
    const existing = await prisma.rayGithubIntegration.findFirst({
      where: { userId: user.userId },
    });

    const safeSelect = {
      id: true,
      githubUsername: true,
      avatarUrl: true,
      createdAt: true,
      updatedAt: true,
    };

    let integration;
    if (existing) {
      integration = await prisma.rayGithubIntegration.update({
        where: { id: existing.id },
        data: {
          githubUsername,
          accessToken: ghToken || existing.accessToken,
          avatarUrl,
          updatedAt: new Date(),
        },
        select: safeSelect,
      });
    } else {
      integration = await prisma.rayGithubIntegration.create({
        data: {
          userId: user.userId,
          githubUsername,
          accessToken: ghToken || null,
          avatarUrl,
        },
        select: safeSelect,
      });
    }

    return NextResponse.json({ ok: true, integration });
  } catch (err) {
    console.error("POST /api/github/connect:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// DELETE /api/github/connect — disconnect GitHub account
export async function DELETE(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("ray_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await verifyToken(token);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await prisma.rayGithubIntegration.deleteMany({
      where: { userId: user.userId },
    });

    return NextResponse.json({ ok: true, disconnected: true });
  } catch (err) {
    console.error("DELETE /api/github/connect:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getApprovedUpstream(rawUpstream: string | null): string | null {
  if (!rawUpstream) return null;

  try {
    const upstream = new URL(rawUpstream);
    if (upstream.protocol !== "http:" ||
        upstream.hostname !== "127.0.0.1" ||
        upstream.username || upstream.password || upstream.pathname !== "/" ||
        upstream.search || upstream.hash || !upstream.port) {
      return null;
    }
    return upstream.origin;
  } catch {
    return null;
  }
}

async function handleProxy(req: NextRequest) {
  const expectedSecret = process.env.BRAIN_INTERNAL_SECRET?.trim();
  if (!expectedSecret || req.headers.get("x-domain-proxy-secret") !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const upstream = getApprovedUpstream(req.headers.get("x-target-upstream"));
  const targetPath = req.headers.get("x-target-path") || "/";

  if (!upstream) {
    return NextResponse.json(
      { error: "No target upstream configured for this domain" },
      { status: 502 }
    );
  }

  const targetUrl = `${upstream}${targetPath.startsWith("/") ? targetPath : "/" + targetPath}`;

  try {
    // Copy incoming headers, omitting hop-by-hop headers
    const forwardHeaders = new Headers();
    req.headers.forEach((val, key) => {
      const lower = key.toLowerCase();
      if (
        lower !== "host" &&
        lower !== "connection" &&
        lower !== "content-length" &&
        !["x-domain-proxy-secret", "x-brain-secret", "x-internal-secret", "x-domain-requested", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer", "proxy-authorization", "proxy-authenticate"].includes(lower) &&
        !lower.startsWith("x-target-")
      ) {
        forwardHeaders.set(key, val);
      }
    });

    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "127.0.0.1";
    forwardHeaders.set("x-forwarded-for", clientIp);
    forwardHeaders.set("x-forwarded-host", req.headers.get("host") || "");
    forwardHeaders.set("x-forwarded-proto", req.nextUrl.protocol.replace(":", ""));

    let body: BodyInit | undefined = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await req.arrayBuffer();
    }

    const upstreamRes = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body,
      redirect: "manual",
    });

    // Copy response headers
    const responseHeaders = new Headers();
    upstreamRes.headers.forEach((val, key) => {
      const lower = key.toLowerCase();
      if (lower !== "content-encoding" && lower !== "transfer-encoding") {
        responseHeaders.set(key, val);
      }
    });

    return new NextResponse(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: responseHeaders,
    });
  } catch {
    return new NextResponse(
      `<html>
        <head><title>503 Service Unavailable</title></head>
        <body style="background:#0a0a0a;color:#fff;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="text-align:center;padding:24px;border:1px solid #222;border-radius:12px;background:#111;max-width:480px;">
            <h2 style="margin:0 0 8px 0;font-size:18px;">503 Service Unavailable</h2>
            <p style="color:#888;font-size:12px;margin:0 0 16px 0;">The application container is starting up or temporarily unreachable.</p>
            <p style="color:#555;font-size:11px;margin:0;">Please check that your container is running in the dashboard.</p>
          </div>
        </body>
      </html>`,
      {
        status: 503,
        headers: { "Content-Type": "text/html" },
      }
    );
  }
}

export const GET = handleProxy;
export const POST = handleProxy;
export const PUT = handleProxy;
export const DELETE = handleProxy;
export const PATCH = handleProxy;
export const OPTIONS = handleProxy;
export const HEAD = handleProxy;

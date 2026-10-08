import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { isDashboardHost } from "@/lib/network";
import { isTokenRevoked } from "@/lib/auth";
import { getSafeRedirectUrl } from "@/lib/redirect";

const INSECURE_JWT_DEFAULTS = [
  "putmein-jwt-secret-default-key-2024",
  "fallback-secret-for-dev-only",
  "secret",
  "test",
  "dev",
  "123456",
  "password",
  "default",
];

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "JWT_SECRET environment variable is missing. Please define JWT_SECRET in your .env file."
    );
  }
  if (INSECURE_JWT_DEFAULTS.includes(secret)) {
    throw new Error(
      "JWT_SECRET is set to an insecure or well-known default key. Please generate a strong random 256-bit secret in your .env file."
    );
  }
  return new TextEncoder().encode(secret);
}

// Routes that require dashboard authentication
const PROTECTED_ROUTES = ["/chat", "/dashboard", "/settings", "/servers", "/projects", "/monitor", "/deployments", "/containers", "/cicd", "/github"];
// Routes that should redirect to /chat if already authenticated
const AUTH_ROUTES = ["/login", "/setup"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hostHeader = request.headers.get("host") || "";

  const isDashboard = isDashboardHost(hostHeader);

  // 1. Bypass internal Next.js assets and proxy resolution paths
  if (isDashboard && (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/domains/resolve") ||
    pathname.startsWith("/api/domain-proxy") ||
    pathname === "/domain-not-found" ||
    pathname === "/favicon.ico"
  )) {
    return NextResponse.next();
  }

  // 2. Determine if request is hitting the Ray Dashboard directly (localhost or direct IP)
  if (isDashboard) {
    // Redirect decommissioned register page to login
    if (pathname === "/register" || pathname.startsWith("/register/")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    const token = request.cookies.get("ray_token")?.value;

    const isProtected = PROTECTED_ROUTES.some((route) =>
      pathname.startsWith(route)
    );
    const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route));

    // Verify token validity
    let isAuthenticated = false;
    if (token) {
      try {
        const { payload } = await jwtVerify(token, getJwtSecret());
        if (isTokenRevoked((payload.jti as string) || undefined, token)) {
          isAuthenticated = false;
        } else {
          isAuthenticated = true;
        }
      } catch {
        isAuthenticated = false;
      }
    }

    // Redirect unauthenticated users away from protected routes
    if (isProtected && !isAuthenticated) {
      const loginUrl = new URL("/login", request.url);
      const targetPath = pathname + (search || "");
      loginUrl.searchParams.set("from", targetPath);
      return NextResponse.redirect(loginUrl);
    }

    // Redirect authenticated users away from login/setup to intended destination or /chat
    if (isAuthRoute && isAuthenticated) {
      const fromParam = request.nextUrl.searchParams.get("from");
      const destination = getSafeRedirectUrl(fromParam);
      return NextResponse.redirect(new URL(destination, request.url));
    }

    return NextResponse.next();
  }

  // 3. Domain Routing: Inbound request via sslip.io or custom domain
  try {
    const resolveUrl = new URL(`/api/domains/resolve?host=${encodeURIComponent(hostHeader)}`, process.env.RAY_INTERNAL_URL || "http://127.0.0.1:3000");
    const res = await fetch(resolveUrl, {
      signal: AbortSignal.timeout(1500),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.found && data.upstream) {
        // Domain is linked to an active project — reverse proxy request
        const forwardHeaders = new Headers(request.headers);
        forwardHeaders.set("x-target-upstream", data.upstream);
        forwardHeaders.set("x-target-path", `${pathname}${search}`);
        forwardHeaders.set("x-domain-requested", hostHeader);
        forwardHeaders.set("x-domain-proxy-secret", process.env.BRAIN_INTERNAL_SECRET || "");

        return NextResponse.rewrite(new URL("/api/domain-proxy", request.url), {
          request: { headers: forwardHeaders },
        });
      }
    }
  } catch {
    // resolution error or timeout
  }

  // 4. Domain is pointing to server IP, but NOT linked to any project:
  // Render generic unbranded Ray-styled 404 page with status code 404.
  const notFoundHeaders = new Headers(request.headers);
  notFoundHeaders.set("x-domain-requested", hostHeader);

  return NextResponse.rewrite(new URL("/domain-not-found", request.url), {
    status: 404,
    request: { headers: notFoundHeaders },
  });
}

export const config = {
  matcher: ["/:path*"],
};

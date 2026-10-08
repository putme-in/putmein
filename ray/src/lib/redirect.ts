/**
 * Validates and returns a safe internal relative redirect path.
 * Guards against open-redirect vulnerabilities (protocol-relative URLs, external schemes, backslashes, CRLF).
 * Avoids redirect loops to authentication routes.
 *
 * @param rawTarget The untrusted destination string from query parameter 'from'.
 * @param fallbackPath The default path to use if rawTarget is missing or unsafe. Defaults to "/dashboard".
 * @returns A safe relative path string.
 */
export function getSafeRedirectUrl(
  rawTarget?: string | null,
  fallbackPath: string = "/dashboard"
): string {
  if (!rawTarget || typeof rawTarget !== "string") {
    return fallbackPath;
  }

  const trimmed = rawTarget.trim();

  // Must start with exactly one forward slash, not protocol-relative '//' or windows-style '/\'
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallbackPath;
  }

  // Must not contain control characters or newlines
  if (/[\r\n\t\0]/.test(trimmed)) {
    return fallbackPath;
  }

  // Inspect the pathname (before '?' and '#') to block scheme injections or backslashes
  const [pathname] = trimmed.split(/[?#]/);
  if (pathname.includes(":") || pathname.includes("\\")) {
    return fallbackPath;
  }

  // Prevent redirect loops back to authentication / setup screens
  const normalizedPath = pathname.toLowerCase();
  if (
    normalizedPath === "/login" ||
    normalizedPath === "/setup" ||
    normalizedPath === "/register"
  ) {
    return fallbackPath;
  }

  return trimmed;
}

import path from "path";
import type { NextConfig } from "next";
import { getMaxUploadRequestBytes, UPLOAD_TIMEOUT_MS } from "./src/lib/upload-config";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Proxy clones multipart bodies before route handlers receive them.
    proxyClientMaxBodySize: getMaxUploadRequestBytes(),
    // Deployment builds can take ten minutes; uploads retain their own five-minute limit.
    proxyTimeout: Math.max(UPLOAD_TIMEOUT_MS, 15 * 60 * 1000),
  },
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  async redirects() {
    return [
      {
        source: "/register",
        destination: "/login",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

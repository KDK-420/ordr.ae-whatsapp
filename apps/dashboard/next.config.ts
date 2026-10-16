import path from "node:path";
import type { NextConfig } from "next";

/**
 * Where the API lives from the dashboard server's point of view. In production Caddy sends
 * /merchant/* straight to the API, so this rewrite only matters for local development.
 */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/merchant/:path*", destination: `${API_INTERNAL_URL}/merchant/:path*` }];
  },
};

export default nextConfig;

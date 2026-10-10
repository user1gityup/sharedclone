import type { NextConfig } from "next";

// App Router (src/app) is used. Next.js 15 selects it automatically; no
// experimental flags are required. All route handlers that read headers, cookies
// or the database declare `export const dynamic = "force-dynamic"`.
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;

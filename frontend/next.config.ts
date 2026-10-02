import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin the tracing root to this app. Without it, Next walks up and finds unrelated
  // lockfiles elsewhere on the machine and warns about an ambiguous workspace root.
  outputFileTracingRoot: process.cwd(),
  // The API base URL is read from NEXT_PUBLIC_API_BASE_URL in src/lib/api.ts,
  // with a localhost fallback so `npm run dev` works with no .env file.
};

export default nextConfig;

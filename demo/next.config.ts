import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  devIndicators: false,
  poweredByHeader: false,
  reactCompiler: true,
  experimental: {
    prefetchInlining: true,
    inlineCss: true,
  },
  allowedDevOrigins: ["192.168.0.200"],
};

export default nextConfig;

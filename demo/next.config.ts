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
};

export default nextConfig;

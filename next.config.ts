import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the tracing root to this project — a stray lockfile in $HOME otherwise
  // makes Next infer the wrong workspace root.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;

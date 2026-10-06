import type { NextConfig } from "next";
import packageJson from "./package.json";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the tracing root to this project — a stray lockfile in $HOME otherwise
  // makes Next infer the wrong workspace root.
  outputFileTracingRoot: process.cwd(),
  // The release version, inlined at build so the page header can show it. The
  // quiz is a client component: importing package.json there would ship all of
  // it to the browser, where only this one string is wanted.
  env: { NEXT_PUBLIC_APP_VERSION: packageJson.version },
};

export default nextConfig;

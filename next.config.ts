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
  // The link test's puzzle image is rasterized by resvg, a native module that
  // must be loaded from node_modules rather than bundled, and it draws its text
  // with the bundled fonts, which are read from disk at request time.
  serverExternalPackages: ["@resvg/resvg-js"],
  outputFileTracingIncludes: {
    "/t/[token]/[n]/puzzle.png": ["./src/app/fonts/*.ttf"],
  },
};

export default nextConfig;

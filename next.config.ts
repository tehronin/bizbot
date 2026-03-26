import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for Tauri sidecar packaging
  output: "standalone",
  // Disable x-powered-by header for security
  poweredByHeader: false,
  // Allow images from social platforms
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "scontent.cdninstagram.com" },
      { protocol: "https", hostname: "graph.facebook.com" },
    ],
  },
  // Environment variables exposed to browser
  env: {
    NEXT_PUBLIC_APP_NAME: "BizBot",
    NEXT_PUBLIC_APP_VERSION: "0.1.0",
  },
};

export default nextConfig;

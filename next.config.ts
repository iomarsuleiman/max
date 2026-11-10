import type { NextConfig } from "next";

const security = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  agentRules: false,
  serverExternalPackages: [],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com" }],
    // Covers and thumbnails: AVIF first, then WebP, cached for a year (the files never change).
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 960, 1280, 1600, 1920, 2560],
    imageSizes: [96, 160, 240, 320],
    qualities: [72, 75],
    minimumCacheTTL: 31_536_000,
  },
  async headers() {
    return [
      { source: "/:path*", headers: security },
      { source: "/covers/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
  async redirects() {
    return [{ source: "/settings", destination: "/home?settings=account", permanent: false }];
  },
};

export default config;

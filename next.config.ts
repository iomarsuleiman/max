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
  // @ts-expect-error -- Next 16 option; keeps the repo free of generated agent files.
  agentRules: false,
  serverExternalPackages: [],
  images: { remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com" }] },
  async headers() {
    return [{ source: "/:path*", headers: security }];
  },
  async redirects() {
    return [{ source: "/settings", destination: "/home?settings=account", permanent: false }];
  },
};

export default config;

import type { NextConfig } from "next";

const dev = process.env.NODE_ENV === "development";
const TURNSTILE = "https://challenges.cloudflare.com";

// shortcut: scripts allow 'unsafe-inline'. Next's inline bootstrap scripts need it unless every page gets a
// per-request nonce, and nonces don't work with Partial Prerendering (see Next's CSP guide). Everything
// else is locked down: no plugins, no foreign scripts, frames, forms or <base>. Revisit if PPR is dropped.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${TURNSTILE}${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'", // style attributes and Next's injected styles
  "img-src 'self' data: blob: https:", // product images from shops' own https hosts; photos chosen on the device
  "font-src 'self'", // next/font serves its files from this site
  `connect-src 'self'${dev ? " ws: wss:" : ""}`, // the browser only talks to this site (dev: hot reload)
  `frame-src ${TURNSTILE}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(dev ? [] : ["upgrade-insecure-requests"]), // would break http://localhost
].join("; ");

const nextConfig: NextConfig = {
  /* config options here */
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  // Dev server only: let phones on the home Wi-Fi (192.168.x.x) load the app's scripts.
  allowedDevOrigins: ["192.168.*.*"],
  // Security headers on every response.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

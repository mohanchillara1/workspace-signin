import type { NextConfig } from 'next';

const production = process.env.NODE_ENV === 'production';

// What the pages may load. Everything is served by this app itself: no
// outside scripts, styles, images or frames. 'unsafe-inline' stays because
// the framework writes small inline scripts and styles; 'wasm-unsafe-eval'
// lets the QR decoder run. Development needs looser rules for live reload,
// so the policy is sent in production builds only.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  // Native or server-only packages that must not be bundled.
  serverExternalPackages: ['@node-rs/argon2', 'pg', 'embedded-postgres'],
  turbopack: { root: process.cwd() },
  // A new value on every build, written into the code. See lib/build.ts.
  env: { BUILD_STAMP: Date.now().toString(36) },
  poweredByHeader: false,
  // Phones on the same wifi open the dev server by the laptop's address.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '192.168.*.*', '10.*.*.*', '*.local'],
  // A browser may ask for /favicon.ico before it has read the page's own
  // icon. It gets that icon, not a 404 in the console.
  async redirects() {
    return [{ source: '/favicon.ico', destination: '/icon.png', permanent: false }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Nothing in this app belongs in a search engine.
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Permissions-Policy', value: 'camera=(self)' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Browsers act on this only when the page came over https.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          ...(production ? [{ key: 'Content-Security-Policy', value: contentSecurityPolicy }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;

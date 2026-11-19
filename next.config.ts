import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native or server-only packages that must not be bundled.
  serverExternalPackages: ['@node-rs/argon2', 'pg', 'embedded-postgres'],
  turbopack: { root: process.cwd() },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Nothing in this app belongs in a search engine.
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Permissions-Policy', value: 'camera=(self)' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;

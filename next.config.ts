import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next generates AGENTS.md/CLAUDE.md on dev by default; this repo keeps its
  // guidance in docs/ instead.
  agentRules: false,
  typescript: { ignoreBuildErrors: false },
  experimental: {
    // Server actions receive project snapshots, which can be a few hundred KB.
    serverActions: { bodySizeLimit: '4mb' },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;

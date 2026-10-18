import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (no build step); Next transpiles them.
  transpilePackages: ['@relay/core', '@relay/db', '@relay/contracts'],
  // `pg` is a native-ish Node dependency; keep it external to the server bundle.
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;

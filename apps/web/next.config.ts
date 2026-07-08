import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Explicitly set the monorepo root so Next.js doesn't pick the wrong
  // workspace root when multiple lockfiles exist on the machine.
  // This prevents the ENOENT vendor-chunks / pack.gz errors.
  outputFileTracingRoot: path.join(__dirname, '../../'),

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'api.qrserver.com' },
    ],
  },

  experimental: {
    serverActions: {
      // Allow any localhost port (3000, 3001, 3002, etc.)
      allowedOrigins: ['localhost:3000', 'localhost:3001', 'localhost:3002'],
    },
  },

  // Disable webpack filesystem cache to prevent stale/corrupted pack.gz files
  // This is the root cause of the ENOENT vendor-chunks error on Windows with OneDrive
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false;
    }
    return config;
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;

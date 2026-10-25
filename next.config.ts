import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {},
  async headers() {
    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), usb=(self), serial=(self)' },
      { key: 'Content-Security-Policy', value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'" },
      ...(process.env.NODE_ENV === 'production'
        ? [{ key: 'Strict-Transport-Security', value: 'max-age=15552000' }]
        : []),
    ];
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'firebase/app': isServer
        ? path.resolve(process.cwd(), 'node_modules/firebase/app/dist/index.cjs.js')
        : path.resolve(process.cwd(), 'node_modules/firebase/app/dist/esm/index.esm.js'),
      'firebase/auth': isServer
        ? path.resolve(process.cwd(), 'node_modules/firebase/auth/dist/index.cjs.js')
        : path.resolve(process.cwd(), 'node_modules/firebase/auth/dist/esm/index.esm.js'),
      'firebase/firestore': isServer
        ? path.resolve(process.cwd(), 'node_modules/firebase/firestore/dist/index.cjs.js')
        : path.resolve(process.cwd(), 'node_modules/firebase/firestore/dist/esm/index.esm.js'),
      '@firebase/app': isServer
        ? path.resolve(process.cwd(), 'node_modules/@firebase/app/dist/index.cjs.js')
        : path.resolve(process.cwd(), 'node_modules/@firebase/app/dist/esm/index.esm.js'),
      '@firebase/auth': isServer
        ? path.resolve(process.cwd(), 'node_modules/@firebase/auth/dist/node/index.js')
        : path.resolve(process.cwd(), 'node_modules/@firebase/auth/dist/esm/index.js'),
      '@firebase/firestore': isServer
        ? path.resolve(process.cwd(), 'node_modules/@firebase/firestore/dist/index.node.cjs.js')
        : path.resolve(process.cwd(), 'node_modules/@firebase/firestore/dist/index.esm.js'),
    };
    return config;
  },
};

export default nextConfig;

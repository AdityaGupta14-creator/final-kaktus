import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {},
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

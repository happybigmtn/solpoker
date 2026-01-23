import type { NextConfig } from "next";
import path from 'path';

const nextConfig: NextConfig = {
  // Static export for Netlify/static hosting
  output: 'export',

  // Transpile the local @robopoker/client package
  transpilePackages: ['@robopoker/client'],

  // Optimize package imports to avoid loading entire barrel files
  // React Best Practice: bundle-barrel-imports
  // This transforms barrel imports to direct imports at build time
  experimental: {
    optimizePackageImports: [
      '@solana/kit',
      '@solana/react-hooks',
      '@solana/client',
      '@solana-program/compute-budget',
    ],
  },

  // Configure webpack to properly handle @solana packages
  webpack: (config, { isServer, dev }) => {
    if (!isServer && !dev) {
      config.optimization = config.optimization || {};

      // CRITICAL: Disable module concatenation to prevent closures from breaking
      // The @solana/codecs base58 encoder uses closures that get broken when
      // modules are concatenated and then minified (alphabet4 becomes undefined)
      config.optimization.concatenateModules = false;

      // Split @solana into its own chunk
      config.optimization.splitChunks = config.optimization.splitChunks || {};
      if (typeof config.optimization.splitChunks === 'object') {
        config.optimization.splitChunks.cacheGroups = {
          ...config.optimization.splitChunks.cacheGroups,
          solana: {
            test: /[\\/]node_modules[\\/]@solana[\\/]/,
            name: 'solana',
            chunks: 'all',
            priority: 30,
            enforce: true,
          },
        };
      }
    }
    return config;
  },
};

export default nextConfig;

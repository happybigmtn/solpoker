import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile the local @robopoker/client package
  transpilePackages: ['@robopoker/client'],

  // Use webpack instead of turbopack for better symlink support
  // This can be removed once turbopack better handles local symlinked packages
};

export default nextConfig;

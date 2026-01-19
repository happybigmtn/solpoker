import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile the local @robopoker/client package
  transpilePackages: ['@robopoker/client'],
};

export default nextConfig;

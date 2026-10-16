import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Headless rendering loads playwright-core at runtime on the server only.
  serverExternalPackages: ["playwright-core"],
};

export default nextConfig;

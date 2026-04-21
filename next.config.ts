import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist"],
  allowedDevOrigins: ["192.168.15.7"],
};

export default nextConfig;

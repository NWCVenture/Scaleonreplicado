import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist"],
  allowedDevOrigins: ["192.168.15.16"],
};

export default nextConfig;

import os from "node:os";

function getDevOrigins() {
  const origins = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name] || []) {
        if (net.family === "IPv4" && !net.internal) {
          origins.add(net.address);
        }
      }
    }
  } catch (e) {
    console.error("Failed to detect network interfaces in next.config.js", e);
  }
  return Array.from(origins);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: getDevOrigins(),
  devIndicators: false,
};

export default nextConfig;

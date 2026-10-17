/** @type {import("next").NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "@prisma/client",
      "jose",
      "stripe",
      "@solana/web3.js",
      "@solana/spl-token",
    ],
  },
};

export default nextConfig;
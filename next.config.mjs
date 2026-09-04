/** @type {import('next').NextConfig} */
const nextConfig = {
  // xlsx and pdf-lib are CommonJS and only ever run in route handlers.
  serverExternalPackages: ["xlsx", "pdf-lib"],
};

export default nextConfig;

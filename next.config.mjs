/** @type {import('next').NextConfig} */
const nextConfig = {
  // xlsx and pdf-lib are CommonJS and only ever run in route handlers.
  serverExternalPackages: ["xlsx", "pdf-lib"],
  // The renderer reads assets/logo.png off disk, so it has to travel with the
  // server build rather than being tree-shaken away.
  outputFileTracingIncludes: { "/api/pdf": ["./assets/**"] },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true, // enables src/instrumentation.ts — runs once on server start
  },
  // Expose NOTHING to the client — all Gemini calls go through /api routes
  serverRuntimeConfig: {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || process.env.API_KEY,
  },
  // Public env vars (safe to expose)
  publicRuntimeConfig: {
    APP_NAME: 'FinPlatform',
  },
};

module.exports = nextConfig;

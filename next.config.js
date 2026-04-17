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
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

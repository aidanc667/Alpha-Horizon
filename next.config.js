/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true, // enables src/instrumentation.ts — runs once on server start
    serverComponentsExternalPackages: [
      '@opentelemetry/sdk-node',
      '@opentelemetry/auto-instrumentations-node',
      '@opentelemetry/exporter-trace-otlp-http',
      '@opentelemetry/resources',
      '@grpc/grpc-js',
      '@grpc/proto-loader',
    ],
  },
  // serverComponentsExternalPackages only applies to the server-components layer.
  // The instrumentation.ts compilation is a separate webpack context and needs
  // its own externals — otherwise @opentelemetry/sdk-node pulls in gRPC packages
  // that import Node.js built-ins (fs, stream) that the bundler can't resolve.
  webpack(config, { isServer }) {
    if (!isServer) return config;

    const grpcAndOtelPkgs = [
      '@grpc/grpc-js',
      '@grpc/proto-loader',
      '@opentelemetry/sdk-node',
      '@opentelemetry/auto-instrumentations-node',
      '@opentelemetry/otlp-grpc-exporter-base',
      '@opentelemetry/exporter-logs-otlp-grpc',
      '@opentelemetry/exporter-trace-otlp-grpc',
    ];

    const prev = config.externals;
    const prevArray = Array.isArray(prev) ? prev : prev != null ? [prev] : [];

    config.externals = [
      ...prevArray,
      ({ request }, callback) => {
        const isNative = grpcAndOtelPkgs.some(
          p => p === request || (request && request.startsWith(p + '/'))
        );
        if (isNative) return callback(null, `commonjs ${request}`);
        callback();
      },
    ];

    return config;
  },
  // Expose NOTHING to the client — all Gemini calls go through /api routes
  serverRuntimeConfig: {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || process.env.API_KEY,
  },
  // Public env vars (safe to expose)
  publicRuntimeConfig: {
    APP_NAME: 'Alpha Horizon',
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

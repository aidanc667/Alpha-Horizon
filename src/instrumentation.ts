/**
 * instrumentation.ts
 *
 * Runs once when the Next.js server starts (both dev and production).
 * Used to create database tables that must exist before any request is served.
 *
 * Without these tables:
 *   macro_cache missing → Capital Markets agent re-runs Google Search every cold start (~20s)
 *   plan_cache missing  → Plan cache never works; every request hits the full pipeline
 */
export async function register() {
  // Only run on the Node.js server runtime — not in the Edge runtime or client.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // OTEL SDK — initialise before any route handlers so spans are captured from cold start.
  // No-ops silently when OTEL_EXPORTER_OTLP_ENDPOINT is not set.
  try {
    const { NodeSDK }                     = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter }           = await import('@opentelemetry/exporter-trace-otlp-http');
    const { resourceFromAttributes }      = await import('@opentelemetry/resources');
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        'service.name':    process.env.OTEL_SERVICE_NAME ?? 'alpha-horizon',
        'service.version': '1.0.0',
      }),
      // OTLPTraceExporter auto-reads OTEL_EXPORTER_OTLP_ENDPOINT from env,
      // appending /v1/traces. Defaults to http://localhost:4318/v1/traces.
      traceExporter: new OTLPTraceExporter(),
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false }, // too noisy
        }),
      ],
    });

    sdk.start();
    console.log('[instrumentation] OTEL SDK started →', process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318');
  } catch (e) {
    console.warn('[instrumentation] OTEL SDK failed to start (traces disabled):', e);
  }

  // DB migrations — must succeed before any request that touches Neon.
  try {
    const { runMigrations } = await import('@/lib/db');
    await runMigrations();
    console.log('[instrumentation] DB migrations complete (macro_cache + plan_cache ready)');
  } catch (e) {
    // Log but never crash the server — app works without cache, just slower.
    console.error('[instrumentation] DB migration failed — cache tables may be missing:', e);
  }
}

// db
import { neon } from '@neondatabase/serverless';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return neon(url);
}

export const sql = new Proxy({} as ReturnType<typeof neon>, {
  get: (_target, prop) => {
    const db = getDb();
    return (db as ReturnType<typeof neon>)[prop as keyof ReturnType<typeof neon>];
  },
  apply: (_target, _thisArg, args) => {
    const db = getDb();
    return (db as (...a: unknown[]) => unknown)(...args);
  },
});

// Tag-template export (primary usage)
export function db() {
  return getDb();
}

/**
 * Run once to create the plan_cache table used by the Portfolio Agent.
 * Stores final validated plans keyed by PLAN_CACHE_VERSION:SHA-256(IntakeAnswers).
 * Survives Lambda cold starts so repeat runs with identical inputs skip the pipeline entirely.
 */
export async function runPlanCacheMigration() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS plan_cache (
      cache_key  TEXT PRIMARY KEY,
      plan_json  JSONB NOT NULL,
      logs_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

/**
 * Run once to create the macro_cache table used by the Portfolio Agent.
 * The Capital Markets agent caches live macro data here so it survives Lambda
 * cold starts — saving 10–20s of Google Search latency per cold-start request.
 * Call from /api/db/migrate or run manually once per environment.
 */
export async function runMacroCacheMigration() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS macro_cache (
      cache_key  TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function runSilasMigration() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS silas_messages (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    TEXT NOT NULL,
      role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS silas_messages_user_id_idx ON silas_messages(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS silas_messages_created_at_idx ON silas_messages(user_id, created_at)`;
}

export async function runWatchlistMigration() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS silas_watchlist (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, ticker)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS silas_watchlist_user_id_idx ON silas_watchlist(user_id)`;
}

/** Run once on first deploy to create tables. Called from instrumentation.ts on startup. */
export async function runMigrations() {
  await runMacroCacheMigration();
  await runPlanCacheMigration();
  await runSilasMigration();
  await runWatchlistMigration();
  // Feature-specific migrations — consolidated here so instrumentation.ts is the single entry point
  await runArenaMigrations();
  await runMarketMigrations();
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS saved_plans (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     TEXT NOT NULL,
      name        TEXT NOT NULL DEFAULT 'My Financial Plan',
      plan_json   JSONB NOT NULL,
      responses_json JSONB NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS saved_plans_user_id_idx ON saved_plans(user_id)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS lab_runs (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      TEXT NOT NULL,
      name         TEXT NOT NULL DEFAULT 'Backtest',
      allocations  JSONB NOT NULL,
      config_json  JSONB NOT NULL,
      metrics_json JSONB NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS lab_runs_user_id_idx ON lab_runs(user_id)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS rate_limits (
      user_id      TEXT NOT NULL,
      endpoint     TEXT NOT NULL,
      window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      count        INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, endpoint)
    )
  `;
}

export async function runMarketMigrations() {
  const sql = db();
  await sql`
    CREATE TABLE IF NOT EXISTS market_daily_records (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      record_date DATE NOT NULL UNIQUE,
      is_noon_locked BOOLEAN DEFAULT FALSE,
      noon_locked_at TIMESTAMPTZ,
      elite6_actual JSONB,
      brief_bullets JSONB,
      outlier TEXT,
      catalyst TEXT,
      weather JSONB,
      live_headlines JSONB,
      tomorrow_predictions JSONB,
      tomorrow_outlook TEXT,
      accuracy_score NUMERIC(5,2),
      accuracy_breakdown JSONB,
      accuracy_calculated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `;
  await sql`ALTER TABLE market_daily_records ADD COLUMN IF NOT EXISTS edge_board JSONB`;
  await sql`ALTER TABLE market_daily_records ADD COLUMN IF NOT EXISTS positioning JSONB`;
  await sql`ALTER TABLE market_daily_records ADD COLUMN IF NOT EXISTS user_spy_prediction VARCHAR(10)`;
  await sql`ALTER TABLE market_daily_records ADD COLUMN IF NOT EXISTS user_prediction_locked_at TIMESTAMPTZ`;
  await sql`ALTER TABLE market_daily_records ADD COLUMN IF NOT EXISTS user_accuracy_correct BOOLEAN`;
  await sql`ALTER TABLE market_daily_records ADD COLUMN IF NOT EXISTS accuracy_brief TEXT`;
}

/** Run once to create Strategy Arena tables */
export async function runArenaMigrations() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS personas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      risk_score INTEGER NOT NULL DEFAULT 5,
      starting_balance NUMERIC(15,2) NOT NULL,
      allocation_method TEXT NOT NULL DEFAULT 'manual',
      allocation_json JSONB NOT NULL,
      benchmark_ticker TEXT NOT NULL DEFAULT 'SPY',
      benchmark_inception_price NUMERIC(15,4) NOT NULL,
      thesis TEXT,
      inception_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS personas_user_id_idx ON personas(user_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS persona_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
      portfolio_value NUMERIC(15,2) NOT NULL,
      benchmark_value NUMERIC(15,2) NOT NULL,
      holdings_detail_json JSONB NOT NULL,
      ai_briefing TEXT,
      ai_briefing_generated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(persona_id, snapshot_date)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS persona_snapshots_persona_id_idx ON persona_snapshots(persona_id)`;
  await sql`ALTER TABLE persona_snapshots ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
}

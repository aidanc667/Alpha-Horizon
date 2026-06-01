# Alpha Horizon — Claude Code Guide

## Project overview
Institutional-grade multi-agent portfolio construction app. Users complete a 7-slide intake wizard (~16 questions); a 7-agent pipeline constructs a personalized ETF portfolio with risk analysis, tax optimization, and a Monte Carlo projection. Built on Next.js 14 App Router, TypeScript strict, Clerk auth, Neon Postgres.

## Dev commands
```bash
npm run dev      # start dev server (localhost:3000)
npm run build    # production build + type check
npm run lint     # ESLint
npx tsc --noEmit # type-check without building
```

## Environment variables (see .env.local.example)
- `DATABASE_URL` — Neon Postgres connection string (required)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — Clerk auth (required)
- `GEMINI_API_KEY` — Agent 7 LLM synthesis (optional; narrative skipped if absent)
- `FRED_API_KEY` — Agent 2 live macro data (optional; falls back to static Jan 2026 CMAs)

## Architecture

### Agent pipeline (`src/app/api/portfolio-agent/route.ts`)
Streams NDJSON (`application/x-ndjson`). Each `{ type: 'log', message }` line maps to one pipeline stage; final `{ type: 'plan', ... }` delivers the complete `V3Plan`.
Rate limited: 10 plans/hr per user via `src/lib/rateLimit.ts` → `rate_limits` table.

| Agent | File | Type | What it does |
|-------|------|------|-------------|
| 1 | `src/lib/agents/agent1.ts` | Deterministic | Risk score, tax profile, goal analysis |
| 2 | `src/lib/agents/agent2.ts` | LLM + FRED | Live macro: regime, CAPE, 10Y yield |
| 3 | `src/lib/agents/agent3.ts` | Sharpe optimizer | Portfolio construction from 28-ETF universe |
| 4 | `src/lib/agents/agent4.ts` | Deterministic (∥ with 5) | Stress tests, drawdown, risk warnings |
| 5 | `src/lib/agents/agent5.ts` | Deterministic (∥ with 4) | Tax placement across account types |
| 6 | `src/lib/agents/agent6.ts` | Deterministic critic | Scores 5 dimensions; triggers 1-pass retry if overall < 85 |
| 7 | `src/lib/agents/agent7_synthesis.ts` | Gemini LLM | Investment narrative (2–5s) |

Critic pass threshold: `overall >= 85` in `agent6.ts`. Retry only triggers for `alignment < 60` or `riskManagement < 60`.

### Intake wizard (`src/components/planner/OnboardingFlow.tsx`)
7 slides — collects all `IntakeAnswers` fields:

| Slide | Label | Key fields |
|-------|-------|-----------|
| 1 | Goal + Timeline | `goal`, `timeHorizon`, `riskTolerance` |
| 2 | Capital | `initialInvestment`, `monthlyContribution` |
| 3 | Income + Tax | `age`, `annualIncome`, `taxFilingStatus`, `taxBracket`, `employerMatchPct` |
| 4 | Financial Foundation | `emergencyFundStatus`, `debtLevel`, `majorExpenseType` |
| 5 | Accounts | `availableAccounts`, `hsaContributing` (sub-question) |
| 6 | Risk DNA | `volatilityComfort`, `investmentExperience`, `drawdownResponse` |
| 7 | Portfolio Preferences | `esgPreference`, `sectorConstraints` (optional) |

### Results dashboard (`src/components/planner/PlanResults.tsx`)
Tabs: Overview · Financial Metrics · Monte Carlo · Tax · Portfolio.

**Financial Metrics** (6): Expected CAGR, Real Return (inflation-adj.), Annual Volatility, Sharpe Ratio, Est. Max Drawdown, Sortino Ratio.
**Monte Carlo**: Analytical lognormal engine (<5ms). Contribution sensitivity at +$250/+$500/+$1K/mo. P50/P10 outcome chips with goal gap indicator.
**Tax tab**: Withdrawal sequencing note (taxable → traditional → Roth). Account-type placement cards. 401k contribution tracker vs IRS limit with employer match callout.

### Caching (`src/lib/agentResponseCache.ts`)
- **L1**: in-process memory (~0ms, lost on cold start)
- **L2**: Neon `plan_cache` table (SHA-256 hash of IntakeAnswers, cache key `plan_v6`, 24hr TTL)
- Macro data separately cached in `macro_cache` table

### Database (`src/lib/db.ts`)
Neon Postgres, auto-migrated on server startup via `src/instrumentation.ts`.
Tables: `plan_cache`, `macro_cache`, `saved_plans`, `lab_runs`, `personas`, `persona_snapshots`, `market_daily_records`, `rate_limits`

### Auth
Clerk via `src/middleware.ts`. Public routes: `/sign-in`, `/sign-up`, `/auth/session`. All API routes are protected.

## Key file map

```
src/lib/agents/
  types.ts              — all pipeline types (IntakeAnswers → V3Plan)
  agent{1-6}.ts         — deterministic agents
  agent7_synthesis.ts   — Gemini LLM agent
  portfolioRules.ts     — ETF selection rules, overlap pairs, risk tier filters
  sharpeOptimizer.ts    — gradient-ascent Sharpe optimizer

src/lib/data/
  etfUniverse.ts        — 28-ETF universe (add new ETFs here first)
  etfAssetClassMapping.ts — ticker → CMA asset class mapping
  institutionalCMAs.ts  — JPM/Vanguard/BlackRock 10-yr return + vol forecasts
  calculateETFReturns.ts — expected return resolver

src/components/planner/
  OnboardingFlow.tsx    — 7-slide intake wizard
  PlanResults.tsx       — results dashboard (tabs + charts)

src/lib/
  rateLimit.ts          — sliding-window rate limiter (DB-backed)
  monteCarlo/analyticalMonteCarlo.ts — Monte Carlo engine
  intake/validation.ts  — intake answer validation
```

## Common tasks

### Adding a new ETF
Touch files in order: `etfUniverse.ts` → `etfAssetClassMapping.ts` → check `institutionalCMAs.ts` (new asset class?) → check `portfolioRules.ts` (overlap pairs). Run `npx tsc --noEmit` to verify.

### Tuning the critic
Edit `WEIGHTS` in `src/lib/agents/agent6.ts`. Weights must sum to 1.0. Pass threshold is `overall >= 85` (same file). Note: `scoreTaxEfficiency` is additive (starts at 0), all others deduct from 100.

### Debugging a bad plan
Read the NDJSON log stream first — each line tells you which agent ran and what it produced. CAPE=25 exactly in the macro line = agent2 fallback (cache/fetch miss). Revision loop = agent6 score < 85 with alignment or riskManagement < 60.

### Bumping cache key
When `IntakeAnswers` schema changes, increment the cache key in `src/lib/agentResponseCache.ts` (currently `plan_v6`) to invalidate stale plans.

## Conventions
- TypeScript strict mode — no `any`, no implicit returns
- Path alias: `@/*` → `src/*`
- Tailwind for all styling; custom tokens: `surface`, `emerald`, `gold`; dark mode via `class`
- Server Components by default; client components only when needed for interactivity
- All AI API calls server-side only — Gemini key never exposed to client
- No test suite currently — use `npx tsc --noEmit` for correctness checks

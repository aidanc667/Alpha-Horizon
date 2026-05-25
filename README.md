# Alpha Horizon

An institutional-grade AI investment terminal — five integrated apps powered by a 7-agent pipeline, a Sharpe optimizer, a closed-form Monte Carlo engine, and a self-correcting critic system.

[![Tests](https://github.com/aidanc667/Alpha-Horizon/actions/workflows/test.yml/badge.svg)](https://github.com/aidanc667/Alpha-Horizon/actions/workflows/test.yml)

---

## Five Apps

| App | What it does |
|-----|-------------|
| **AI Financial Planner** | Answers 12 intake questions → runs the 7-agent pipeline → delivers a full ETF portfolio with risk analysis, tax optimization, and a Monte Carlo projection |
| **Portfolio Growth Lab** | Backtest any ETF portfolio against historical data; generates Sharpe, max drawdown, CAGR, and Sortino metrics with AI-generated commentary |
| **Market Analysis Console** | Aggregates daily macro indicators, sector rotation signals, and top financial news with AI-generated causal analysis into a triple-card layout: yesterday's forecast accuracy, today's live market pulse, tomorrow's locked predictions |
| **Silas — AI Wealth Advisor** | Multi-mode AI advisor with 7 conversation modes; a context bridge automatically syncs the user's live portfolio allocations, backtest metrics, and current prices from other tabs into a structured session object injected into every prompt |
| **Strategy Arena** | Paper trading simulator with persona-based strategies, live price data, and AI briefings per position |

---

## Architecture

### 7-Agent Pipeline

The planner runs a streaming NDJSON pipeline (`/api/portfolio-agent`). Each stage emits a `{ type: 'log' }` event; the final message delivers the complete `V3Plan`.

| # | Agent | Type | Role |
|---|-------|------|------|
| 1 | Client Profile | Deterministic | Risk score, tax profile, goal classification |
| 2 | Economic Intelligence | LLM + FRED API | Live macro regime: CAPE, 10Y yield, credit spreads, inflation |
| 3 | Portfolio Construction | Sharpe optimizer | Gradient-ascent allocation across a 28-ETF universe |
| 4 | Risk Analysis | Deterministic (∥ Agent 5) | Stress tests, max drawdown, VaR, risk warnings |
| 5 | Tax Optimization | Deterministic (∥ Agent 4) | Asset location across account types, 50-state marginal tax model, TLH estimates |
| 6 | Critic | Deterministic | Scores 5 dimensions (alignment, diversification, risk, tax, cost); triggers a 1-pass retry if overall score < 85 |
| 7 | Synthesis | Gemini LLM | Investment narrative summarizing the full plan |

Agents 4 and 5 run in parallel. The critic evaluates the result and retriggers Agent 3 with tightened constraints if needed — no LLM is involved in scoring, preventing drift.

### Monte Carlo Engine

Closed-form analytical engine in `src/lib/monteCarlo/analyticalMonteCarlo.ts`. Generates P10/P50/P90 wealth projections and goal success probability in **under 5ms** — no simulation loops.

### Caching

Two-layer cache on every portfolio plan:

- **L1** — in-process memory (~0ms, lost on cold start)
- **L2** — Neon `plan_cache` table (SHA-256 hash of intake answers, 24hr TTL)

Macro data from Agent 2 is separately cached in `macro_cache`. A cache hit skips all 7 agents and returns instantly.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router, TypeScript strict) |
| Auth | Clerk |
| Database | Neon Postgres (auto-migrated on server start) |
| AI | Gemini 2.0 Flash (`@google/genai`) |
| Market Data | FRED API, Yahoo Finance (proxied server-side) |
| Styling | Tailwind CSS, Framer Motion |
| Charts | Recharts |
| Observability | OpenTelemetry → Grafana Tempo |
| Deployment | Vercel (cron job: market close data at 5:05 PM ET weekdays) |
| Testing | Vitest (unit), adversarial red team suite |

---

## Getting Started

### Prerequisites

- Node.js 20+
- A [Clerk](https://clerk.com) account
- A [Neon](https://neon.tech) Postgres database
- A [Gemini](https://aistudio.google.com) API key

### 1. Clone and install

```bash
git clone https://github.com/aidanc667/Alpha-Horizon.git
cd Alpha-Horizon
npm install
```

### 2. Configure environment variables

```bash
cp .env.local.example .env.local
```

Then fill in `.env.local` — see the table below.

### 3. Start the dev server

```bash
npm run dev
# → http://localhost:3000
```

The database tables are created automatically on first server start via `src/instrumentation.ts`. No manual migration needed.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk publishable key |
| `CLERK_SECRET_KEY` | ✅ | Clerk secret key |
| `DATABASE_URL` | ✅ | Neon Postgres connection string |
| `GEMINI_API_KEY` | ✅ | Gemini API key — server-side only, never sent to the browser |
| `FRED_API_KEY` | Optional | Live macro data for Agent 2. Without it, Agent 2 falls back to static January 2026 estimates |
| `POLYGON_API_KEY` | Optional | Real-time prices for Silas. Free tier is sufficient for development |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional | OTLP endpoint for trace export (default: `http://localhost:4318`) |

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── portfolio-agent/   # Streaming 7-agent pipeline
│   │   ├── market/            # Market data + daily cron
│   │   ├── silas/             # AI advisor chat
│   │   ├── personas/          # Strategy Arena paper trading
│   │   ├── lab-runs/          # Backtest persistence
│   │   └── prices/            # Proxied price feeds
│   └── (pages)/               # sign-in, sign-up, planner, lab
│
├── lib/
│   ├── agents/
│   │   ├── agent{1-6}.ts      # Deterministic pipeline stages
│   │   ├── agent7_synthesis.ts # Gemini narrative synthesis
│   │   ├── sharpeOptimizer.ts  # Gradient-ascent Sharpe optimizer
│   │   ├── portfolioRules.ts   # ETF overlap pairs, risk tier filters
│   │   └── types.ts            # IntakeAnswers → V3Plan types
│   ├── data/
│   │   ├── etfUniverse.ts      # 28-ETF universe
│   │   ├── institutionalCMAs.ts # JPM/Vanguard/BlackRock 10-yr forecasts
│   │   └── etfAssetClassMapping.ts
│   ├── monteCarlo/
│   │   └── analyticalMonteCarlo.ts # Closed-form Monte Carlo engine
│   ├── market/                 # Scoring, sector rotation logic
│   ├── agentResponseCache.ts   # L1 + L2 caching
│   └── db.ts                   # Neon client + schema
│
├── components/
│   ├── planner/               # IntakeWizard, ResultsDashboard
│   ├── advisor/               # Silas chat interface
│   ├── arena/                 # Strategy Arena, PersonaDetail
│   ├── market/                # MarketTab, TripleCardMarket
│   ├── lab/                   # Backtesting UI
│   └── layout/                # Sidebar, DashboardLayout, HomeLanding
│
└── types/                     # Shared TypeScript types

eval/
├── red_team/                  # Adversarial test suite
│   ├── adversarial_intake.ts  # Prompt injection, boundary tests
│   ├── critic_gaming.ts       # Critic score manipulation tests
│   └── cache_poisoning.ts     # Cache integrity tests
└── test_synthesis.py          # Agent 7 output quality tests
```

---

## Evaluation & Red Teaming

The CI pipeline runs three adversarial test suites on every push:

- **`adversarial_intake`** — sends malformed, boundary-pushing, and prompt-injection intake answers through the full pipeline and asserts the output is still a valid `V3Plan`
- **`critic_gaming`** — attempts to construct inputs that score above the critic threshold without meeting actual quality criteria
- **`cache_poisoning`** — verifies that cache hits cannot be forced with manipulated SHA-256 hashes

```bash
# Run all tests locally
npm test
```

---

## Observability

The full request lifecycle is traced with OpenTelemetry. To view traces locally:

```bash
# Start Grafana + Tempo
docker compose up -d
# → Grafana at http://localhost:3100 → Explore → Tempo
```

Every portfolio agent run emits spans for each agent stage, cache lookups, and FRED API calls.

---

## Security

- All AI API keys are server-side only — accessed exclusively inside `/api/` route handlers via `process.env`, never exposed to the client
- All API routes are protected by Clerk authentication middleware
- Security headers set globally: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `Permissions-Policy`
- Rate limiting enforced at the database layer (`rate_limits` table) for all AI endpoints

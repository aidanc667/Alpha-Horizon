# FinPlatform — Unified AI Financial Dashboard

A production-ready **Next.js 14** unified dashboard for:
- 🛡️ **AI Financial Planner** — Gemini-powered 3-bucket institutional allocation strategy
- 🧪 **Portfolio Growth Lab** — Historical backtesting with Yahoo Finance + AI commentary

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set your Gemini API key (NEVER commit this file)
cp .env.local.example .env.local
# Edit .env.local → set GEMINI_API_KEY=your_key_here

# 3. Run development server
npm run dev
# → Open http://localhost:3000
```

---

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout with DM Sans/Serif/Mono fonts
│   ├── globals.css             # Tailwind + custom animations
│   ├── page.tsx                # Entry point — AuthGuard + DashboardLayout
│   └── api/
│       ├── gemini/route.ts     # 🔒 Secure Gemini API proxy (server-only)
│       └── history/route.ts    # 🔒 Yahoo Finance proxy (avoids CORS)
│
├── components/
│   ├── auth/
│   │   └── AuthGuard.tsx       # Placeholder auth — activate with real provider
│   ├── layout/
│   │   ├── Sidebar.tsx         # Navigation sidebar with status indicators
│   │   └── DashboardLayout.tsx # Shell layout managing active tab state
│   ├── planner/
│   │   ├── PlannerTab.tsx      # Orchestrates onboarding → API → results
│   │   ├── OnboardingFlow.tsx  # 10-step questionnaire
│   │   └── PlanResults.tsx     # Full results: buckets, charts, tax, report
│   └── lab/
│       └── LabTab.tsx          # Portfolio simulator with controls + charts
│
├── lib/
│   ├── simulationEngine.ts     # Portfolio math engine (calls /api/history)
│   ├── assets.ts               # Curated ETF list (from original AFP)
│   └── constants.ts            # Bucket rates and defaults
│
└── types/
    └── index.ts                # Shared TypeScript types for both apps
```

---

## Security Architecture

```
Browser                    Next.js Server
  │                              │
  ├─ POST /api/gemini ──────────►│ process.env.GEMINI_API_KEY (server-only)
  │   { action, responses }      │        │
  │◄── { plan } ─────────────────│        ▼
  │                              │   GoogleGenAI({ apiKey })
  ├─ GET /api/history ──────────►│        │
  │   ?ticker=SPY&from=...       │        ▼
  │◄── { data } ─────────────────│  fetch(Yahoo Finance)
```

**The API key is NEVER sent to the browser.** It lives only in `process.env` on the server, accessed exclusively inside `/api/` route handlers.

---

## Activating AuthGuard

1. Install your auth provider (e.g. NextAuth.js, Clerk, Supabase):
   ```bash
   npm install next-auth
   # or: npm install @clerk/nextjs
   ```

2. Open `src/components/auth/AuthGuard.tsx`

3. Set `AUTH_ENABLED = true`

4. Replace the stub `useAuth()` hook with your provider's hook:
   ```ts
   // NextAuth example:
   import { useSession } from 'next-auth/react';
   function useAuth() {
     const { data, status } = useSession();
     return {
       isAuthenticated: status === 'authenticated',
       isLoading: status === 'loading',
       user: data?.user ?? null,
       signIn: () => signIn(),
       signOut: () => signOut(),
     };
   }
   ```

---

## Adding New Features (with Claude)

The platform is ready for Claude to build on top of. Suggested next features:

| Feature | Files to modify |
|---|---|
| Bridge: "Backtest this plan" button | `PlanResults.tsx` → pass tickers to `LabTab` via URL or context |
| Saved portfolios (localStorage) | New `SavedPortfolios.tsx` component |
| Dark/light theme toggle | `DashboardLayout.tsx` + Tailwind `dark:` classes |
| Portfolio comparison (A vs B) | New `/api/compare` route + `CompareTab.tsx` |
| Export to PDF | `/api/export/route.ts` with puppeteer or jsPDF |
| User preferences panel | New `SettingsTab.tsx` in sidebar |

---

## Environment Variables

| Variable | Description | Used in |
|---|---|---|
| `GEMINI_API_KEY` | Your Google Gemini API key | `/api/gemini` (server only) |
| `API_KEY` | Alias for backward compatibility | `/api/gemini` (server only) |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS 3 |
| Icons | Lucide React |
| Charts | Recharts |
| AI | `@google/genai` (Gemini 2.0 Flash) |
| Market Data | Yahoo Finance v8 API (proxied) |
| Fonts | DM Sans, DM Serif Display, DM Mono |
| Type Safety | TypeScript 5 |

---

## API Routes

### `POST /api/gemini`
Handles all Gemini AI calls server-side.

**Actions:**
- `generatePlan` — structured JSON plan from onboarding responses
- `generateReport` — streaming markdown investment report  
- `portfolioCommentary` — post-simulation AI commentary

### `GET /api/history`
Proxies Yahoo Finance historical price data.

**Params:** `?ticker=SPY&from=2020-01-01&to=2024-12-31`

---

*FinPlatform © 2026 — Monorepo Unified Build*

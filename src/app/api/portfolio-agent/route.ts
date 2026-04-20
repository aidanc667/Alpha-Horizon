import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { agent1_clientProfile }         from '@/lib/agents/agent1';
import { agent2_economicIntelligence }  from '@/lib/agents/agent2';
import { agent3_portfolioConstruction } from '@/lib/agents/agent3';
import { agent4_riskAnalysis }          from '@/lib/agents/agent4';
import { agent5_taxOptimization }       from '@/lib/agents/agent5';
import { agent6_critic }                from '@/lib/agents/agent6';
import { agent7_synthesis }             from '@/lib/agents/agent7_synthesis';
import { runMonteCarlo }                from '@/lib/monteCarlo/analyticalMonteCarlo';
import type {
  IntakeAnswers,
  Agent1Output, Agent2Output, Agent3Output,
  Agent4Output, Agent5Output, Agent6Output, Agent7Output,
  MonteCarloOutput,
} from '@/lib/agents/types';

// Vercel function timeout — deterministic pipeline runs well under 5s,
// but keep headroom for Neon cold starts.
export const maxDuration = 60;

// ─── V3 plan shape ────────────────────────────────────────────────────────────

interface V3Plan {
  version:         'v3';
  generatedAt:     string;
  clientProfile:   Agent1Output;
  economicIntel:   Agent2Output;
  portfolio:       Agent3Output;
  riskAnalysis:    Agent4Output;
  taxOptimization: Agent5Output;
  criticScore:     Agent6Output;
  monteCarlo:      MonteCarloOutput;
  synthesis?:      Agent7Output;
}

// ─── L2 plan cache (Neon plan_cache table, 24hr TTL) ─────────────────────────

function planCacheKey(intakeAnswers: IntakeAnswers): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD — invalidates daily with market data
  return `plan_v3_${date}_${createHash('sha256').update(JSON.stringify(intakeAnswers)).digest('hex').slice(0, 16)}`;
}

async function checkCache(cacheKey: string): Promise<V3Plan | null> {
  try {
    const sql = db();
    const rows = await sql`
      SELECT plan_json FROM plan_cache
      WHERE cache_key = ${cacheKey}
        AND created_at > NOW() - INTERVAL '24 hours'
      LIMIT 1
    ` as Array<{ plan_json: V3Plan }>;
    return rows.length > 0 ? rows[0].plan_json : null;
  } catch {
    return null; // fail open — run pipeline on cache miss
  }
}

function saveCache(cacheKey: string, plan: V3Plan): void {
  void (async () => {
    try {
      const sql = db();
      await sql`
        INSERT INTO plan_cache (cache_key, plan_json, created_at)
        VALUES (${cacheKey}, ${JSON.stringify(plan)}::jsonb, NOW())
        ON CONFLICT (cache_key) DO UPDATE
          SET plan_json = EXCLUDED.plan_json, created_at = EXCLUDED.created_at
      `;
    } catch (e) {
      console.error('[portfolio-agent] cache write failed:', e);
    }
  })();
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth + parse before stream opens so HTTP-level errors return non-200
  let intakeAnswers: IntakeAnswers;
  try {
    const body = await req.json();
    intakeAnswers = (body as { answers: IntakeAnswers }).answers;
    if (!intakeAnswers) return NextResponse.json({ error: 'Missing answers' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const push = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch { /* closed */ }
      };
      const log = (msg: string) => push({ type: 'log', message: msg });

      try {
        // ── L2 cache check ────────────────────────────────────────────────────
        const cacheKey = planCacheKey(intakeAnswers);
        const cached   = await checkCache(cacheKey);
        if (cached) {
          log('Loaded from cache.');
          push({ type: 'plan', plan: cached });
          push({ type: 'done' });
          controller.close();
          return;
        }

        const t0 = Date.now();

        // ── Agent 1: Client Profile (deterministic, <2ms) ─────────────────────
        log('Agent 1/7: Deriving client profile...');
        const clientProfile = agent1_clientProfile({ intakeAnswers });

        if (clientProfile.constraints.hardStops.length > 0) {
          push({
            type:  'error',
            error: `Portfolio blocked: ${clientProfile.constraints.hardStops.join('; ')}`,
          });
          controller.close();
          return;
        }

        log(`Profile: risk ${clientProfile.riskProfile.riskScore}/10 | ${clientProfile.timeHorizon.yearsToGoal}yr | ${(clientProfile.taxProfile.combinedMarginalRate * 100).toFixed(0)}% combined rate`);

        // ── Agent 2: Economic Intelligence (cache → static fallback) ──────────
        log('Agent 2/7: Loading market context...');
        const economicIntel = await agent2_economicIntelligence({ requestDate: new Date().toISOString() });
        log(`Macro: ${economicIntel.regime.current} | rf ${(economicIntel.assetClassOutlook.riskFreeRate * 100).toFixed(2)}% | equity ${economicIntel.assetClassOutlook.equityValuation}`);

        // ── Agent 3: Portfolio Construction (<30ms) ───────────────────────────
        log('Agent 3/7: Constructing portfolio...');
        const portfolio = agent3_portfolioConstruction({ clientProfile, economicIntel });
        log(`Portfolio: ${portfolio.allocation.length} holdings | return ${(portfolio.statistics.expectedReturn * 100).toFixed(1)}% | Sharpe ${portfolio.statistics.sharpeRatio.toFixed(2)}`);

        // ── Agents 4 + 5 in parallel (<15ms total) ────────────────────────────
        log('Agent 4/7: Running risk analysis...');
        log('Agent 5/7: Running tax optimization...');
        const [riskAnalysis, taxOptimization] = await Promise.all([
          Promise.resolve(agent4_riskAnalysis({ portfolio, clientProfile })),
          Promise.resolve(agent5_taxOptimization({ portfolio, clientProfile })),
        ]);
        log(`Risk: ${riskAnalysis.riskLevel} (${riskAnalysis.warnings.length} warning${riskAnalysis.warnings.length !== 1 ? 's' : ''})`);
        log(`Tax: ${taxOptimization.estimatedAnnualSavings}bps potential savings`);

        // ── Agent 6: Critic (<20ms) ───────────────────────────────────────────
        log('Agent 6/7: Scoring portfolio...');
        const criticScore = agent6_critic({ portfolio, clientProfile, riskAnalysis, taxOptimization });
        log(`Score: ${criticScore.scores.overall}/100 — ${criticScore.passesThreshold ? 'APPROVED' : 'review suggested'}`);

        // ── Monte Carlo (<5ms) ────────────────────────────────────────────────
        const monteCarlo = runMonteCarlo(portfolio, clientProfile, clientProfile.timeHorizon.yearsToGoal);
        log(`Monte Carlo: p50 at goal year = $${monteCarlo.projections.at(-1)?.p50.toLocaleString() ?? '—'} | success ${(monteCarlo.goalSuccessProbability * 100).toFixed(0)}%`);

        // ── Agent 7: LLM Synthesis (2–5s, requires GEMINI_API_KEY) ────────────
        log('Agent 7/7: Writing personalised narrative...');
        const synthesis = await agent7_synthesis({
          clientProfile,
          economicIntel,
          portfolio,
          riskAnalysis,
          taxOptimization,
          criticScore,
        });
        if (synthesis) {
          log(`Narrative: generated in ${synthesis.executionTimeMs}ms`);
        } else {
          log('Narrative: skipped (GEMINI_API_KEY not set)');
        }

        // ── Assemble + stream plan ────────────────────────────────────────────
        const plan: V3Plan = {
          version:      'v3',
          generatedAt:  new Date().toISOString(),
          clientProfile,
          economicIntel,
          portfolio,
          riskAnalysis,
          taxOptimization,
          criticScore,
          monteCarlo,
          ...(synthesis ? { synthesis } : {}),
        };

        console.log(JSON.stringify({
          stage: 'pipeline_complete',
          durationMs: Date.now() - t0,
          score: criticScore.scores.overall,
          riskLevel: riskAnalysis.riskLevel,
          withinSLA: (Date.now() - t0) < 1000,
        }));

        push({ type: 'plan', plan });

        // ── Cache write (fire-and-forget) ─────────────────────────────────────
        saveCache(cacheKey, plan);

        push({ type: 'done' });
        controller.close();

      } catch (e: unknown) {
        console.error('[POST /api/portfolio-agent]', e);
        push({ type: 'error', error: e instanceof Error ? e.message : 'Server error' });
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no', // disable Vercel/nginx buffering — flush chunks immediately
    },
  });
}

'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { IntakeAnswers, AgentName, AgentStatus } from '../types';
import type { V3Plan } from '@/lib/agents/types';
import { AGENT_PIPELINE, AGENT_LABELS, AGENT_DESCRIPTIONS, AGENT_ICONS } from '../constants';

interface AgentStatusPanelProps {
  answers: IntakeAnswers;
  onComplete: (plan: V3Plan) => void;
  onReset: () => void;
}

// How long each agent's spinner shows before moving to the next (visual only).
// All agents except the LAST one animate freely. The last agent (criticEvaluator)
// holds its spinner until the API actually responds — so the user always sees
// "something running" until the real work is done.
const HOLD_UNTIL_API = Number.MAX_SAFE_INTEGER;

const AGENT_VISUAL_MS: Record<AgentName, number> = {
  clientProfile:         500,
  capitalMarkets:        4500,
  portfolioConstruction: 4000,
  riskAgent:             2500,
  taxImplementation:     2000,
  criticEvaluator:       HOLD_UNTIL_API,
};

// Client-side hard timeout: if the API hasn't responded in 110 seconds, show an error.
// Set slightly below server maxDuration (120s) so the client error shows before Vercel cuts the connection.
const CLIENT_TIMEOUT_MS = 110_000;

// Stream chunk types emitted by the route
type StreamChunk =
  | { type: 'log';   message: string }
  | { type: 'plan';  plan: V3Plan; logs: string[] }
  | { type: 'error'; error: string }
  | { type: 'done' };

export default function AgentStatusPanel({ answers, onComplete, onReset }: AgentStatusPanelProps) {
  const [agentStatuses, setAgentStatuses] = useState<Record<AgentName, AgentStatus>>(
    () => Object.fromEntries(AGENT_PIPELINE.map(n => [n, 'idle'])) as Record<AgentName, AgentStatus>
  );
  const [currentAgent, setCurrentAgent] = useState<AgentName | null>(null);
  const [logs, setLogs] = useState<string[]>(['Initializing pipeline...']);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  // apiFetchDone gates onComplete — set the moment a 'plan' chunk arrives.
  // animDone is intentionally removed: we no longer wait for the animation
  // before rendering results. onComplete fires as soon as the plan is ready.
  const [apiFetchDone, setApiFetchDone] = useState(false);

  const planResult = useRef<{ plan: V3Plan; logs: string[] } | null>(null);
  const completionFired = useRef(false);
  const fastForward = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  function addLog(msg: string) {
    setLogs(prev => [...prev.slice(-20), msg]);
  }

  // ── Elapsed timer ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setElapsedSec(0);
    const t = setInterval(() => setElapsedSec(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [retryCount]);

  // ── Streaming fetch ───────────────────────────────────────────────────────────
  // Reads NDJSON chunks from the route. Each chunk is a JSON object on one line.
  // The 'plan' chunk triggers onComplete immediately — no animation gate.
  // If the server sends a second 'plan' chunk (revision improved score), we update.
  useEffect(() => {
    let cancelled = false;
    completionFired.current = false;
    planResult.current = null;
    fastForward.current = false;

    const controller = new AbortController();
    abortRef.current = controller;

    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        controller.abort();
        setFetchError(
          'The analysis is taking longer than expected (90s). This is usually a temporary Gemini API slowdown. Please try again.'
        );
      }
    }, CLIENT_TIMEOUT_MS);

    async function run() {
      try {
        const res = await fetch('/api/portfolio-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers }),
          signal: controller.signal,
        });
        if (cancelled) return;

        // HTTP-level errors (401, 400, 500 before stream) return JSON
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          setFetchError(err.error ?? `Request failed (${res.status})`);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) { setFetchError('No response body — cannot read stream'); return; }
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          if (cancelled) break;
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // keep incomplete last line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let chunk: StreamChunk;
            try { chunk = JSON.parse(trimmed) as StreamChunk; } catch { continue; }

            if (chunk.type === 'log') {
              addLog(chunk.message);
            } else if (chunk.type === 'plan') {
              // ── Render immediately — no animation gate (Change 1+2) ──────────
              // planResult may be set multiple times if the server streams an improved
              // revision. Each update triggers a re-render via setApiFetchDone.
              planResult.current = { plan: chunk.plan, logs: chunk.logs ?? [] };
              fastForward.current = true;
              clearTimeout(timeoutId);

              if (!completionFired.current) {
                // First plan: fire onComplete immediately so the parent transitions
                // to the results view without waiting for the animation to complete.
                completionFired.current = true;
                onComplete(chunk.plan as V3Plan);
              }
              // Second plan (revision): update state; parent re-renders if it
              // subscribes to plan changes. setApiFetchDone(true) is idempotent.
              setApiFetchDone(true);
            } else if (chunk.type === 'error') {
              setFetchError(chunk.error);
              return;
            }
            // 'done' chunk: stream closing — loop will hit done=true naturally
          }
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof Error && e.name === 'AbortError') return;
        setFetchError(e instanceof Error ? e.message : 'Network error — check your connection and try again');
      } finally {
        clearTimeout(timeoutId);
      }
    }

    run();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  // ── Animation (visual only — decoupled from result rendering) ─────────────────
  // Runs independently of the fetch. The last agent holds its spinner until
  // fastForward.current becomes true (plan chunk received), then fast-forwards.
  // The parent unmounts this component when onComplete fires, cancelling everything.
  useEffect(() => {
    let cancelled = false;

    async function simulate() {
      for (const agent of AGENT_PIPELINE) {
        if (cancelled) return;
        setCurrentAgent(agent);
        setAgentStatuses(prev => ({ ...prev, [agent]: 'running' }));

        const duration = AGENT_VISUAL_MS[agent];
        const step = 50;
        let elapsed = 0;
        while (elapsed < duration) {
          if (cancelled) return;
          if (fastForward.current) break;
          await new Promise(r => setTimeout(r, step));
          elapsed += step;
        }

        if (agent === AGENT_PIPELINE[AGENT_PIPELINE.length - 1]) {
          while (!fastForward.current && !cancelled) {
            await new Promise(r => setTimeout(r, 100));
          }
        }

        if (cancelled) return;
        setAgentStatuses(prev => ({ ...prev, [agent]: 'complete' }));
        if (fastForward.current) await new Promise(r => setTimeout(r, 80));
      }

      if (!cancelled) setCurrentAgent(null);
    }

    simulate();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  function handleRetry() {
    abortRef.current?.abort();
    setFetchError(null);
    setApiFetchDone(false);
    setAgentStatuses(Object.fromEntries(AGENT_PIPELINE.map(n => [n, 'idle'])) as Record<AgentName, AgentStatus>);
    setLogs(['Retrying pipeline...']);
    setRetryCount(c => c + 1);
  }

  if (fetchError) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-slate-900 border border-red-500/30 rounded-2xl p-8 text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-white font-bold text-xl">Analysis Failed</h2>
          <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">{fetchError}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={onReset} className="px-5 py-2.5 bg-white/6 hover:bg-white/10 text-slate-300 rounded-xl transition-all text-sm border border-white/8">
              Start Over
            </button>
            <button onClick={handleRetry} className="px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl transition-all text-sm">
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Determine if we're in the "waiting on API after animation would have finished" state
  const lastAgentRunning = agentStatuses[AGENT_PIPELINE[AGENT_PIPELINE.length - 1]] === 'running';
  const allEarlierDone = AGENT_PIPELINE.slice(0, -1).every(a => agentStatuses[a] === 'complete');
  const isWaitingOnApi = lastAgentRunning && allEarlierDone && elapsedSec > 12;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="bg-slate-900 border border-white/8 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
            <span className="text-cyan-400 text-sm">🤖</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold">Running Portfolio Analysis</h2>
            <p className="text-slate-400 text-xs">
              {isWaitingOnApi
                ? `Evaluating plan quality — ${elapsedSec}s elapsed`
                : currentAgent
                  ? `${AGENT_LABELS[currentAgent]} is running...`
                  : apiFetchDone ? 'Finalizing...' : 'Processing...'}
            </p>
          </div>
          {/* Live elapsed timer */}
          <span className="text-slate-600 text-xs font-mono flex-shrink-0">{elapsedSec}s</span>
        </div>

        <div className="space-y-2">
          {AGENT_PIPELINE.map((agent, idx) => {
            const status = agentStatuses[agent];
            return (
              <div key={agent} className={`flex items-center gap-4 p-3 rounded-xl transition-all ${status === 'running' ? 'bg-cyan-500/8 border border-cyan-500/20' : 'border border-transparent'}`}>
                <div className="flex-shrink-0 w-7 h-7 flex items-center justify-center">
                  {status === 'complete' && (
                    <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                      <span className="text-emerald-400 text-xs">✓</span>
                    </div>
                  )}
                  {status === 'running' && <div className="w-6 h-6 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />}
                  {status === 'idle'    && <div className="w-5 h-5 rounded-full bg-slate-700 border border-white/10" />}
                </div>
                <span className="text-lg">{AGENT_ICONS[agent]}</span>
                <div className="flex-1 min-w-0">
                  <div className={`font-medium text-sm ${status === 'running' ? 'text-cyan-300' : status === 'complete' ? 'text-white' : 'text-slate-500'}`}>
                    {AGENT_LABELS[agent]}
                  </div>
                  {status === 'running' && <div className="text-slate-400 text-xs truncate">{AGENT_DESCRIPTIONS[agent]}</div>}
                </div>
                <span className={`text-xs font-mono flex-shrink-0 ${status === 'complete' ? 'text-emerald-500' : 'text-slate-600'}`}>{idx + 1}/6</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-slate-900 border border-white/8 rounded-2xl p-4">
        <div className="text-slate-500 text-xs font-mono mb-3 uppercase tracking-wide">Agent Logs</div>
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {logs.slice(-8).map((log, i) => (
            <div key={i} className="text-slate-400 text-xs font-mono flex items-start gap-2">
              <span className="text-slate-600 flex-shrink-0">›</span>
              <span>{log}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-center text-slate-600 text-xs">Typically completes in 15–30 seconds · Do not close this tab</p>
    </div>
  );
}

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { IntakeAnswers } from '@/lib/agents/types';
import type { AgentName } from '@/apps/portfolio-agent/types';
import type { V3Plan } from '@/lib/agents/types';
import type { IPSDocument } from '@/types';
import { AGENT_PIPELINE, AGENT_LABELS, AGENT_DESCRIPTIONS, AGENT_ICONS } from '@/apps/portfolio-agent/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentStatus = 'idle' | 'running' | 'complete';
type Phase = 'streaming' | 'done';

interface CriticIteration {
  label: string;
  score: number;
  isBest: boolean;
  description: string;
}

interface AgentEntry {
  status: AgentStatus;
  summary?: string;
}

type StreamChunk =
  | { type: 'agent_start'; agent: string }
  | { type: 'agent_done';  agent: string; summary: string; data?: unknown }
  | { type: 'log';         message: string }
  | { type: 'plan';        plan: V3Plan; logs?: string[] }
  | { type: 'ips';         ips: IPSDocument }
  | { type: 'done' }
  | { type: 'error';       error: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const CLIENT_TIMEOUT_MS = 110_000;
const MIN_DISPLAY_MS    = 12_000;

// Agent accent colors for the streaming timeline
const AGENT_COLORS: Record<AgentName, string> = {
  clientProfile:          '#06b6d4',  // cyan
  capitalMarkets:         '#818cf8',  // indigo
  portfolioConstruction:  '#34d399',  // emerald
  riskAgent:              '#f59e0b',  // amber
  taxImplementation:      '#fb7185',  // rose
  criticEvaluator:        '#a78bfa',  // violet
  ipsGenerator:           '#94a3b8',  // slate
};

const ALL_AGENTS: AgentName[] = [...AGENT_PIPELINE, 'ipsGenerator'];

// ─── Props ────────────────────────────────────────────────────────────────────

interface AgentStreamPanelProps {
  answers: IntakeAnswers;
  onComplete: (plan: V3Plan, ips?: IPSDocument) => void;
  onReset: () => void;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SpinnerRing({ color }: { color: string }) {
  return (
    <div
      className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
      style={{ borderColor: `${color}40`, borderTopColor: 'transparent', borderRightColor: color }}
    />
  );
}

function AgentRow({
  agent,
  status,
  summary,
  isLast,
}: {
  agent: AgentName;
  status: AgentStatus;
  summary?: string;
  isLast: boolean;
}) {
  const color = AGENT_COLORS[agent];
  const isRunning  = status === 'running';
  const isComplete = status === 'complete';

  return (
    <div className="relative flex gap-4">
      {/* Vertical connector line */}
      {!isLast && (
        <div
          className="absolute left-[19px] top-8 bottom-0 w-px transition-colors duration-500"
          style={{ backgroundColor: isComplete ? `${color}30` : 'rgba(255,255,255,0.05)' }}
        />
      )}

      {/* Status icon */}
      <div className="flex-shrink-0 z-10">
        {isComplete && (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: `${color}18`, border: `1.5px solid ${color}50` }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2.5 7L5.5 10L11.5 4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}
        {isRunning && (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: `${color}10`, border: `1.5px solid ${color}40` }}
          >
            <SpinnerRing color={color} />
          </div>
        )}
        {status === 'idle' && (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1.5px solid rgba(255,255,255,0.08)' }}
          >
            <span className="text-slate-600 text-base">{AGENT_ICONS[agent]}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-5 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {(isRunning || isComplete) && (
            <span className="text-base leading-none">{AGENT_ICONS[agent]}</span>
          )}
          <span
            className="text-sm font-semibold transition-colors duration-300"
            style={{ color: isRunning ? color : isComplete ? '#e2e8f0' : '#475569' }}
          >
            {AGENT_LABELS[agent]}
          </span>
          {isRunning && (
            <span
              className="text-xs font-mono px-1.5 py-0.5 rounded"
              style={{ background: `${color}15`, color }}
            >
              RUNNING
            </span>
          )}
        </div>

        {isRunning && (
          <p className="text-xs text-slate-500 leading-relaxed">
            {AGENT_DESCRIPTIONS[agent]}
          </p>
        )}

        {isComplete && summary && (
          <p className="text-xs font-mono leading-relaxed" style={{ color: `${color}cc` }}>
            {summary}
          </p>
        )}

        {status === 'idle' && (
          <p className="text-xs text-slate-700">Queued</p>
        )}
      </div>
    </div>
  );
}

// ─── Streaming overlay (during generation) ────────────────────────────────────

function StreamingOverlay({
  agents,
  logs,
  elapsedSec,
  currentAgent,
  fetchError,
  onRetry,
  onReset,
}: {
  agents: Record<AgentName, AgentEntry>;
  logs: string[];
  elapsedSec: number;
  currentAgent: AgentName | null;
  fetchError: string | null;
  onRetry: () => void;
  onReset: () => void;
}) {
  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const doneCount = ALL_AGENTS.filter(a => agents[a].status === 'complete').length;

  if (fetchError) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 backdrop-blur-sm">
        <div className="max-w-md w-full mx-4 bg-slate-900 border border-red-500/30 rounded-2xl p-8 space-y-5 text-center">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-white font-bold text-xl">Analysis Failed</h2>
          <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 font-mono">
            {fetchError}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={onReset}
              className="px-5 py-2.5 bg-white/6 hover:bg-white/10 text-slate-300 rounded-xl transition-all text-sm border border-white/8"
            >
              Start Over
            </button>
            <button
              onClick={onRetry}
              className="px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-xl transition-all text-sm"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/97 backdrop-blur-sm overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-white text-sm font-semibold">Running Portfolio Analysis</span>
          {currentAgent && (
            <span className="text-slate-500 text-xs">
              — {AGENT_LABELS[currentAgent]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-600 text-xs font-mono">{doneCount}/{ALL_AGENTS.length} agents</span>
          <span className="text-slate-700 text-xs font-mono">{elapsedSec}s</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          {/* Agent pipeline */}
          <div className="space-y-0">
            {ALL_AGENTS.map((agent, idx) => (
              <AgentRow
                key={agent}
                agent={agent}
                status={agents[agent].status}
                summary={agents[agent].summary}
                isLast={idx === ALL_AGENTS.length - 1}
              />
            ))}
          </div>

          {/* Log feed */}
          <div className="mt-8 rounded-xl border border-white/5 bg-white/2 p-4">
            <div className="text-slate-600 text-xs font-mono uppercase tracking-widest mb-3">
              Live Logs
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto font-mono text-xs">
              {logs.slice(-12).map((log, i) => (
                <div key={i} className="flex items-start gap-2 text-slate-500">
                  <span className="text-slate-700 flex-shrink-0">›</span>
                  <span>{log}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex-shrink-0 border-t border-white/5 px-6 py-3">
        <p className="text-center text-slate-700 text-xs">
          Typically completes in 15–30 seconds · Do not close this tab
        </p>
      </div>
    </div>
  );
}

// ─── Accordion (post-completion) ──────────────────────────────────────────────

function CompletedAccordion({
  agents,
  criticScore,
  criticIterations,
}: {
  agents: Record<AgentName, AgentEntry>;
  criticScore?: number;
  criticIterations?: CriticIteration[];
}) {
  const [open, setOpen] = useState(false);

  const scoreColor =
    criticScore === undefined ? '#94a3b8'
    : criticScore >= 90 ? '#10b981'
    : criticScore >= 80 ? '#f59e0b'
    : '#ef4444';

  return (
    <div className="border border-white/8 rounded-xl bg-slate-900/60 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/3 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="text-slate-300 text-sm font-medium">View Agent Reasoning</span>
          <span className="text-xs text-slate-600 font-mono">{ALL_AGENTS.length} agents complete</span>
          {criticScore !== undefined && (
            <span
              className="text-xs font-mono font-bold px-2 py-0.5 rounded"
              style={{ color: scoreColor, background: `${scoreColor}18` }}
            >
              Score {criticScore}/100
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        )}
      </button>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-white/5 px-4 py-5">
          <div className="space-y-0">
            {ALL_AGENTS.map((agent, idx) => (
              <AgentRow
                key={agent}
                agent={agent}
                status={agents[agent].status}
                summary={agents[agent].summary}
                isLast={idx === ALL_AGENTS.length - 1}
              />
            ))}
          </div>

          {criticIterations && criticIterations.length > 0 && (
            <div className="mt-5 border-t border-white/5 pt-4">
              <div className="text-xs font-mono uppercase tracking-widest text-slate-600 mb-3">
                Critic Loop — {criticIterations.length} iteration{criticIterations.length !== 1 ? 's' : ''}
              </div>
              <div className="space-y-2">
                {criticIterations.map((it, i) => (
                  <div key={i} className="flex items-start gap-3 text-xs">
                    <span className="font-mono text-slate-600 w-4 flex-shrink-0">{i + 1}.</span>
                    <span className={`font-mono flex-shrink-0 ${it.isBest ? 'text-emerald-400 font-bold' : 'text-slate-400'}`}>
                      {it.label}
                    </span>
                    {it.score > 0 && (
                      <span className="font-mono text-slate-500 flex-shrink-0">{it.score}/100</span>
                    )}
                    <span className="text-slate-600">{it.description}</span>
                    {it.isBest && <span className="text-emerald-500 text-[10px] font-bold flex-shrink-0">✓ BEST</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AgentStreamPanel({ answers, onComplete, onReset }: AgentStreamPanelProps) {
  const [phase, setPhase] = useState<Phase>('streaming');
  const [agents, setAgents] = useState<Record<AgentName, AgentEntry>>(
    () => Object.fromEntries(ALL_AGENTS.map(n => [n, { status: 'idle' as AgentStatus }])) as Record<AgentName, AgentEntry>
  );
  const [logs, setLogs] = useState<string[]>(['Initializing pipeline...']);
  const [currentAgent, setCurrentAgent] = useState<AgentName | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [criticScore, setCriticScore] = useState<number | undefined>(undefined);
  const [criticIterations, setCriticIterations] = useState<CriticIteration[]>([]);

  const abortRef       = useRef<AbortController | null>(null);
  const startTimeRef   = useRef<number>(Date.now());
  const completedRef   = useRef(false);
  const ipsRef         = useRef<IPSDocument | undefined>(undefined);

  function addLog(msg: string) {
    setLogs(prev => [...prev.slice(-30), msg]);
  }

  function markAgent(agent: AgentName, status: AgentStatus, summary?: string) {
    setAgents(prev => ({ ...prev, [agent]: { status, summary: summary ?? prev[agent]?.summary } }));
    if (status === 'running') setCurrentAgent(agent);
    if (status === 'complete' && currentAgent === agent) setCurrentAgent(null);
  }

  // ── Elapsed timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    setElapsedSec(0);
    const t = setInterval(() => setElapsedSec(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [retryCount]);

  // ── Stream fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    completedRef.current = false;
    ipsRef.current = undefined;
    startTimeRef.current = Date.now();

    const controller = new AbortController();
    abortRef.current = controller;

    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        controller.abort();
        setFetchError('The analysis is taking longer than expected. This is usually a temporary API slowdown. Please try again.');
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

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          setFetchError(err.error ?? `Request failed (${res.status})`);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) { setFetchError('No response body'); return; }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          if (cancelled) break;
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let chunk: StreamChunk;
            try { chunk = JSON.parse(trimmed) as StreamChunk; } catch { continue; }

            if (chunk.type === 'agent_start') {
              const name = chunk.agent as AgentName;
              if (ALL_AGENTS.includes(name)) markAgent(name, 'running');
              addLog(`[${AGENT_LABELS[name] ?? chunk.agent}] started`);

            } else if (chunk.type === 'agent_done') {
              const name = chunk.agent as AgentName;
              if (ALL_AGENTS.includes(name)) markAgent(name, 'complete', chunk.summary);
              addLog(`[${AGENT_LABELS[name] ?? chunk.agent}] done — ${chunk.summary.slice(0, 80)}`);

              // Extract critic score from the evaluator summary
              if (name === 'criticEvaluator') {
                const match = chunk.summary.match(/(\d+)\/100/);
                if (match) setCriticScore(Number(match[1]));
              }

            } else if (chunk.type === 'log') {
              addLog(chunk.message);
              const msg = chunk.message;

              const exploreMatch = msg.match(/^Critic explore \[([^\]]+)\]: (\d+)\/100/);
              if (exploreMatch) {
                const [, seedLabel, scoreStr] = exploreMatch;
                setCriticIterations(prev => [...prev, {
                  label: `Explore: ${seedLabel}`,
                  score: Number(scoreStr),
                  isBest: false,
                  description: `Tested ${seedLabel} seed portfolio`,
                }]);
              }

              const newBestMatch = msg.match(/^Critic: \[([^\]]+)\] is new best/);
              if (newBestMatch) {
                setCriticIterations(prev =>
                  prev.map((it, i) => i === prev.length - 1
                    ? { ...it, isBest: true, description: it.description + ' — selected as best' }
                    : it)
                );
              }

              const refineMatch = msg.match(/^Critic refinement pass (\d+) \[([^\]]+)\]: (\d+)\/100/);
              if (refineMatch) {
                const [, passNum, strategy, scoreStr] = refineMatch;
                setCriticIterations(prev => [...prev, {
                  label: `Refine pass ${passNum}`,
                  score: Number(scoreStr),
                  isBest: false,
                  description: `Targeted ${strategy} improvement`,
                }]);
              }

              if (msg.includes('floor hit')) {
                setCriticIterations(prev => [...prev, {
                  label: 'Early exit',
                  score: 0,
                  isBest: false,
                  description: 'Parameter floor reached — no further optimization possible',
                }]);
              }

            } else if (chunk.type === 'ips') {
              ipsRef.current = chunk.ips;

            } else if (chunk.type === 'plan') {
              clearTimeout(timeoutId);
              if (!completedRef.current) {
                completedRef.current = true;
                const plan = chunk.plan;
                // Capture critic score from plan if available
                if (plan.criticScore?.scores?.overall !== undefined) {
                  setCriticScore(plan.criticScore.scores.overall);
                }
                const elapsed = Date.now() - startTimeRef.current;
                const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
                setTimeout(() => {
                  if (!cancelled) {
                    setPhase('done');
                    // Mark any agents still idle/running as complete (cache hit scenario)
                    setAgents(prev =>
                      Object.fromEntries(
                        ALL_AGENTS.map(a => [a, { ...prev[a], status: prev[a].status === 'complete' ? 'complete' : 'complete' as AgentStatus }])
                      ) as Record<AgentName, AgentEntry>
                    );
                    onComplete(plan, ipsRef.current);
                  }
                }, remaining);
              }

            } else if (chunk.type === 'error') {
              setFetchError(chunk.error);
              return;
            }
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

  function handleRetry() {
    abortRef.current?.abort();
    setFetchError(null);
    setPhase('streaming');
    setCriticScore(undefined);
    setCriticIterations([]);
    setAgents(Object.fromEntries(ALL_AGENTS.map(n => [n, { status: 'idle' as AgentStatus }])) as Record<AgentName, AgentEntry>);
    setLogs(['Retrying pipeline...']);
    setRetryCount(c => c + 1);
  }

  if (phase === 'streaming') {
    return (
      <StreamingOverlay
        agents={agents}
        logs={logs}
        elapsedSec={elapsedSec}
        currentAgent={currentAgent}
        fetchError={fetchError}
        onRetry={handleRetry}
        onReset={onReset}
      />
    );
  }

  return (
    <CompletedAccordion
      agents={agents}
      criticScore={criticScore}
      criticIterations={criticIterations}
    />
  );
}

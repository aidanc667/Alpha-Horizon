'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, TrendingUp, Trophy, Swords, Loader2, AlertCircle } from 'lucide-react';
import PersonaCard from './PersonaCard';
import PersonaDetail from './PersonaDetail';
import CreatePersonaFlow from './CreatePersonaFlow';
import type { Persona, PersonaSnapshot } from '@/types';

interface PersonaWithSnapshot extends Persona {
  latest_snapshot?: PersonaSnapshot | null;
}

type SortBy = 'newest' | 'best_today' | 'best_all' | 'worst_today';

export default function ArenaTab() {
  const [personas, setPersonas] = useState<PersonaWithSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<'roster' | 'detail'>('roster');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [migrated, setMigrated] = useState(false);
  const [priceWarning, setPriceWarning] = useState<string | null>(null);
  const lastRefreshedAt = useRef<number>(0);
  const REFRESH_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

  const loadPersonas = useCallback(async (silentRefresh = false) => {
    try {
      const res = await fetch('/api/personas');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const loaded: PersonaWithSnapshot[] = data.personas || [];
      setPersonas(loaded);

      if (silentRefresh && loaded.length > 0) {
        lastRefreshedAt.current = Date.now();
        setPriceWarning(null);
        // Refresh all personas in parallel for live today% — fire-and-forget, update cards when done
        Promise.all(
          loaded.map(p =>
            fetch(`/api/personas/${p.id}/refresh`, { method: 'POST' })
              .then(r => r.json())
              .catch(() => null)
          )
        ).then(results => {
          const allFailed = results.flatMap(r => r?.failedTickers ?? []);
          if (allFailed.length > 0) {
            const unique = [...new Set(allFailed)];
            setPriceWarning(`⚠️ Price fetch failed for: ${unique.join(', ')} — showing last known values`);
          }
          return fetch('/api/personas').then(r => r.json());
        }).then(d => { if (d?.personas) setPersonas(d.personas); })
          .catch(() => null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load personas');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load personas on first mount
  useEffect(() => {
    if (migrated) return;
    setMigrated(true);
    loadPersonas(true);
  }, [migrated, loadPersonas]);

  // Re-refresh prices when the user comes back to this browser tab, throttled to once per 5 min
  useEffect(() => {
    const handleFocus = () => {
      if (Date.now() - lastRefreshedAt.current >= REFRESH_THROTTLE_MS) {
        loadPersonas(true);
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [loadPersonas, REFRESH_THROTTLE_MS]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this persona? This cannot be undone.')) return;
    try {
      await fetch(`/api/personas/${id}`, { method: 'DELETE' });
      setPersonas(prev => prev.filter(p => p.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const handleCreated = (personaId: string) => {
    setShowCreate(false);
    setSelectedId(personaId);
    setView('detail');
    loadPersonas();
  };

  const sortedPersonas = [...personas].sort((a, b) => {
    const aSnap = a.latest_snapshot;
    const bSnap = b.latest_snapshot;
    if (sortBy === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (sortBy === 'best_all') {
      const aRet = aSnap ? (Number(aSnap.portfolio_value) / Number(a.starting_balance) - 1) : 0;
      const bRet = bSnap ? (Number(bSnap.portfolio_value) / Number(b.starting_balance) - 1) : 0;
      return bRet - aRet;
    }
    if (sortBy === 'best_today' || sortBy === 'worst_today') {
      const getTodayRet = (p: PersonaWithSnapshot) => p.latest_snapshot?.holdings_detail_json
        ? p.latest_snapshot.holdings_detail_json.reduce((s, h) => s + h.todayChangePct * h.weightCurrent, 0)
        : 0;
      return sortBy === 'best_today' ? getTodayRet(b) - getTodayRet(a) : getTodayRet(a) - getTodayRet(b);
    }
    return 0;
  });

  if (view === 'detail' && selectedId) {
    return <PersonaDetail personaId={selectedId} onBack={() => { setView('roster'); setSelectedId(null); }} onDelete={(id) => { setPersonas(prev => prev.filter(p => p.id !== id)); }} />;
  }

  const SORT_OPTIONS: { id: SortBy; label: string }[] = [
    { id: 'newest', label: 'Newest' },
    { id: 'best_all', label: 'Best All-Time' },
    { id: 'best_today', label: 'Best Today' },
    { id: 'worst_today', label: 'Worst Today' },
  ];

  return (
    <div className="min-h-full" style={{ background: '#faf8f3' }}>
      <div className="max-w-7xl mx-auto px-6 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="font-sans uppercase mb-1" style={{ fontSize: 9.5, letterSpacing: '0.16em', fontWeight: 600, color: '#b91c1c' }}>
              ● Strategy Arena
            </p>
            <h1 className="font-display font-semibold" style={{ fontSize: 24, color: '#1a1008', lineHeight: 1.2 }}>
              Investor Personas
            </h1>
            <p className="font-sans mt-1" style={{ fontSize: 12, color: '#6b5840' }}>Paper trade · Real prices · Benchmark comparison</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 font-sans font-semibold rounded-[7px] transition-all"
            style={{ padding: '8px 18px', background: '#b91c1c', color: '#fff', fontSize: 13 }}
          >
            <Plus className="w-4 h-4" />New Persona
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-xl mb-4">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-sm" style={{ color: '#b91c1c' }}>{error}</p>
          </div>
        )}

        {/* Price fetch warning */}
        {priceWarning && (
          <div className="flex items-center justify-between gap-3 p-3 bg-amber-500/10 border border-amber-500/25 rounded-xl mb-4">
            <p className="text-xs" style={{ color: '#92400e' }}>{priceWarning}</p>
            <button onClick={() => setPriceWarning(null)} className="text-xs flex-shrink-0" style={{ color: '#92400e' }}>Dismiss</button>
          </div>
        )}

        {/* Stats Bar */}
        {personas.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { label: 'Total Personas', value: personas.length.toString(), icon: Swords, iconColor: '#b91c1c', iconBg: 'rgba(185,28,28,0.08)' },
              {
                label: 'Best Performer',
                value: (() => {
                  if (!sortedPersonas.length) return '—';
                  const best = sortedPersonas.reduce((b, p) => {
                    const bRet = b.latest_snapshot ? Number(b.latest_snapshot.portfolio_value) / Number(b.starting_balance) - 1 : 0;
                    const pRet = p.latest_snapshot ? Number(p.latest_snapshot.portfolio_value) / Number(p.starting_balance) - 1 : 0;
                    return pRet > bRet ? p : b;
                  });
                  const ret = best.latest_snapshot ? (Number(best.latest_snapshot.portfolio_value) / Number(best.starting_balance) - 1) * 100 : 0;
                  return `${best.name.split(' ')[0]} (+${ret.toFixed(1)}%)`;
                })(),
                icon: Trophy,
                iconColor: '#16a34a',
                iconBg: 'rgba(22,163,74,0.08)',
              },
              {
                label: 'Beating Benchmark',
                value: (() => {
                  const beating = personas.filter(p => {
                    if (!p.latest_snapshot) return false;
                    const pRet = Number(p.latest_snapshot.portfolio_value) / Number(p.starting_balance) - 1;
                    const bRet = Number(p.latest_snapshot.benchmark_value) / Number(p.starting_balance) - 1;
                    return pRet > bRet;
                  }).length;
                  return `${beating} / ${personas.length}`;
                })(),
                icon: TrendingUp,
                iconColor: '#6366f1',
                iconBg: 'rgba(99,102,241,0.08)',
              },
            ].map(stat => (
              <div key={stat.label} style={{ background: '#ffffff', border: '1px solid #ebe4d8', borderRadius: 10, padding: '14px 16px', position: 'relative', overflow: 'hidden' }} className="flex items-center gap-3">
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: '#b91c1c' }} />
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: stat.iconBg }}>
                  <stat.icon className="w-5 h-5" style={{ color: stat.iconColor }} />
                </div>
                <div>
                  <p style={{ color: '#6b5840', fontSize: 10 }}>{stat.label}</p>
                  <p style={{ color: '#1a1008', fontWeight: 700, fontSize: 14 }}>{stat.value}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sort controls */}
        {personas.length > 0 && (
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs" style={{ color: '#6b5840' }}>Sort:</span>
            {SORT_OPTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setSortBy(s.id)}
                className="transition-all"
                style={sortBy === s.id
                  ? { background: '#fff1f2', border: '1px solid #fecdd3', color: '#b91c1c', borderRadius: 8, padding: '3px 10px', fontSize: 12, fontWeight: 600 }
                  : { color: '#6b5840', fontSize: 12, padding: '3px 10px', border: '1px solid transparent', borderRadius: 8 }
                }
              >{s.label}</button>
            ))}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#b91c1c' }} />
          </div>
        )}

        {/* Empty State */}
        {!loading && personas.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: '#fff1f2', border: '1px solid #fecdd3' }}>
              <Swords className="w-8 h-8" style={{ color: 'rgba(185,28,28,0.5)' }} />
            </div>
            <h3 className="font-bold text-lg mb-2" style={{ color: '#1a1008' }}>No Personas Yet</h3>
            <p className="text-sm max-w-sm mb-6" style={{ color: '#6b5840' }}>
              Create your first hypothetical investor persona and watch their portfolio compete against a benchmark in real-time.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-5 py-3 font-bold rounded-xl transition-all"
              style={{ background: '#b91c1c', color: '#fff' }}
            >
              <Plus className="w-4 h-4" />Create First Persona
            </button>
          </div>
        )}

        {/* Persona Grid */}
        {!loading && sortedPersonas.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sortedPersonas.map(p => (
              <PersonaCard
                key={p.id}
                persona={p}
                snapshot={p.latest_snapshot || null}
                onClick={() => { setSelectedId(p.id); setView('detail'); }}
                onDelete={() => handleDelete(p.id)}
              />
            ))}
          </div>
        )}

      </div>

      {/* Create Flow Modal */}
      {showCreate && (
        <CreatePersonaFlow
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

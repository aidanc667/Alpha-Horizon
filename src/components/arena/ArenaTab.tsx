'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Swords, TrendingUp, Trophy, Loader2, AlertCircle } from 'lucide-react';
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

  const loadPersonas = useCallback(async (silentRefresh = false) => {
    try {
      const res = await fetch('/api/personas');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const loaded: PersonaWithSnapshot[] = data.personas || [];
      setPersonas(loaded);

      if (silentRefresh && loaded.length > 0) {
        // Refresh all personas in parallel for live today% — fire-and-forget, update cards when done
        Promise.all(
          loaded.map(p => fetch(`/api/personas/${p.id}/refresh`, { method: 'POST' }).catch(() => null))
        ).then(() =>
          fetch('/api/personas')
            .then(r => r.json())
            .then(d => { if (d.personas) setPersonas(d.personas); })
            .catch(() => null)
        );
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load personas');
    } finally {
      setLoading(false);
    }
  }, []);

  // Run migration on first load
  useEffect(() => {
    if (migrated) return;
    setMigrated(true);
    fetch('/api/arena/migrate', { method: 'POST' })
      .then(() => loadPersonas(true))
      .catch(() => loadPersonas(true));
  }, [migrated, loadPersonas]);

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
    <div className="min-h-full" style={{ background: 'linear-gradient(135deg, #0a0d12 0%, #0f1419 40%, #141d27 100%)' }}>
      <div className="max-w-7xl mx-auto px-6 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
              <Swords className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h1 className="font-brand font-extrabold text-white tracking-[-0.02em] leading-none" style={{ fontSize: '1.75rem' }}>STRATEGY ARENA</h1>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] mt-1" style={{ color: 'rgba(241,244,248,0.4)' }}>Paper trade · Real prices · Benchmark comparison</p>
            </div>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm rounded-xl transition-all shadow-lg shadow-amber-500/20"
          >
            <Plus className="w-4 h-4" />New Persona
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-xl mb-4">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Stats Bar */}
        {personas.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { label: 'Total Personas', value: personas.length.toString(), icon: Swords, color: 'text-amber-400' },
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
                color: 'text-emerald-400',
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
                color: 'text-blue-400',
              },
            ].map(stat => (
              <div key={stat.label} className="bg-slate-900 border border-white/8 rounded-xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/6 flex items-center justify-center flex-shrink-0">
                  <stat.icon className={`w-5 h-5 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-slate-400 text-xs">{stat.label}</p>
                  <p className="text-white font-bold text-sm">{stat.value}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sort controls */}
        {personas.length > 0 && (
          <div className="flex items-center gap-2 mb-4">
            <span className="text-slate-500 text-xs">Sort:</span>
            {SORT_OPTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setSortBy(s.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  sortBy === s.id ? 'bg-amber-500/20 border border-amber-500/30 text-amber-300' : 'text-slate-500 hover:text-slate-300 border border-transparent'
                }`}
              >{s.label}</button>
            ))}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          </div>
        )}

        {/* Empty State */}
        {!loading && personas.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
              <Swords className="w-8 h-8 text-amber-500/60" />
            </div>
            <h3 className="text-white font-bold text-lg mb-2">No Personas Yet</h3>
            <p className="text-slate-400 text-sm max-w-sm mb-6">
              Create your first hypothetical investor persona and watch their portfolio compete against a benchmark in real-time.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-5 py-3 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl transition-all"
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

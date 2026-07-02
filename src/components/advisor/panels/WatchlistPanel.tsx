'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Eye, Plus, Loader2, TrendingUp, TrendingDown, RefreshCw, X } from 'lucide-react';
import clsx from 'clsx';

interface TickerPrice {
  price: number | null;
  changePct: number | null;
  loading: boolean;
}

export function WatchlistPanel({
  onAskSilas,
}: {
  onAskSilas: (prompt: string) => void;
}) {
  const [tickers, setTickers] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, TickerPrice>>({});
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const fetchPrice = useCallback(async (ticker: string) => {
    setPrices(prev => ({ ...prev, [ticker]: { price: null, changePct: null, loading: true } }));
    try {
      const res = await fetch('/api/market', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'polygonTicker', ticker }),
      });
      const data = await res.json();
      if (data.success) {
        setPrices(prev => ({ ...prev, [ticker]: { price: data.data.price, changePct: data.data.changePct, loading: false } }));
      } else {
        setPrices(prev => ({ ...prev, [ticker]: { price: null, changePct: null, loading: false } }));
      }
    } catch {
      setPrices(prev => ({ ...prev, [ticker]: { price: null, changePct: null, loading: false } }));
    }
  }, []);

  // Load watchlist on mount
  useEffect(() => {
    fetch('/api/silas/watchlist').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.tickers?.length) {
        setTickers(d.tickers);
        d.tickers.forEach((t: string) => fetchPrice(t));
      }
    }).catch(() => {});
  }, [fetchPrice]);

  // Auto-refresh prices every 60s when visible
  useEffect(() => {
    if (tickers.length === 0) return;
    const tick = () => { if (!document.hidden) tickers.forEach(t => fetchPrice(t)); };
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, [tickers, fetchPrice]);

  const addTicker = async () => {
    const t = input.trim().toUpperCase();
    if (!t || tickers.length >= 20) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch('/api/silas/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: t }) });
      if (res.status === 409) { setAddError(`${t} is already in your watchlist`); return; }
      if (!res.ok) { const d = await res.json(); setAddError(d.error || 'Failed to add ticker'); return; }
      setTickers(prev => [...prev, t]);
      fetchPrice(t);
      setInput('');
    } finally {
      setAdding(false);
    }
  };

  const removeTicker = async (ticker: string) => {
    await fetch('/api/silas/watchlist', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker }) });
    setTickers(prev => prev.filter(t => t !== ticker));
    setPrices(prev => { const n = { ...prev }; delete n[ticker]; return n; });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-shrink-0 border-b border-zinc-200 px-6 py-4 bg-zinc-50">
        <div className="flex items-center gap-2 mb-1">
          <Eye className="w-4 h-4" style={{ color: '#C9A84C' }} />
          <span className="text-sm font-bold text-zinc-900">Watchlist</span>
          <span className="text-[10px] text-zinc-400 font-medium ml-1">Auto-refreshes every 60s</span>
        </div>
        <p className="text-xs text-zinc-500 leading-relaxed mb-3">Track your favorite tickers with live prices and daily change. Hit &quot;Ask Silas&quot; on any position to get a real-time read.</p>
        <div className="flex items-center gap-3">
          <div className={clsx('flex items-center gap-2 flex-1 bg-white border rounded-xl px-4 py-2.5 focus-within:ring-2 focus-within:ring-orange-100 transition-all',
            addError ? 'border-red-300 focus-within:border-red-400' : 'border-zinc-200 focus-within:border-[#C9A84C]'
          )}>
            <Eye className="w-4 h-4 text-zinc-400 flex-shrink-0" />
            <input
              value={input}
              onChange={e => { setInput(e.target.value.toUpperCase()); setAddError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') addTicker(); }}
              placeholder="Add ticker (e.g. AAPL, NVDA, SPY)"
              className="flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none uppercase font-mono"
              disabled={adding || tickers.length >= 20}
            />
          </div>
          <button
            onClick={addTicker}
            disabled={adding || !input.trim() || tickers.length >= 20}
            className="disabled:bg-zinc-200 disabled:text-zinc-400 text-xs font-bold px-4 py-2.5 rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap"
            style={{ background: '#C9A84C', color: '#1a1008' }}
          >
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add
          </button>
        </div>
        {addError && <p className="text-xs text-red-500 mt-1.5">{addError}</p>}
        {!addError && tickers.length >= 20 && <p className="text-xs text-zinc-400 mt-2">Maximum 20 tickers reached.</p>}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
        {tickers.length === 0 ? (
          <div className="text-center py-16">
            <Eye className="w-12 h-12 text-zinc-200 mx-auto mb-4" />
            <p className="text-sm font-semibold text-zinc-500 mb-2">Your watchlist is empty</p>
            <p className="text-xs text-zinc-400 max-w-xs mx-auto leading-relaxed">Add tickers above to track live prices and get Silas&apos;s take on any position.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tickers.map(ticker => {
              const p = prices[ticker];
              const isUp = p?.changePct != null && p.changePct >= 0;
              return (
                <div key={ticker} className="flex items-center gap-4 bg-white border border-zinc-200 hover:border-zinc-300 rounded-xl px-4 py-3.5 transition-all group">
                  <div className="w-20 flex-shrink-0">
                    <p className="text-sm font-bold text-zinc-900 font-mono">{ticker}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    {p?.loading ? (
                      <p className="text-xs text-zinc-400">Loading…</p>
                    ) : p?.price != null ? (
                      <div className="flex items-center gap-3">
                        <span className="text-base font-bold text-zinc-900">${p.price.toFixed(2)}</span>
                        {p.changePct != null && (
                          <span className={clsx(
                            'flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full',
                            isUp ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                          )}>
                            {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {isUp ? '+' : ''}{p.changePct.toFixed(2)}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-400">Price unavailable</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => fetchPrice(ticker)}
                      className="p-1.5 text-zinc-400 hover:text-zinc-600 transition-colors"
                      title="Refresh price"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onAskSilas(`Give me your read on ${ticker} right now — current price action, what I should know, and whether you'd be adding, holding, or trimming at these levels.`)}
                      className="text-[11px] font-semibold bg-[#fefce8] hover:bg-yellow-100 border border-[#fde68a] px-3 py-1.5 rounded-lg transition-all whitespace-nowrap"
                      style={{ color: '#C9A84C' }}
                    >
                      Ask Silas
                    </button>
                    <button
                      onClick={() => removeTicker(ticker)}
                      className="p-1.5 text-zinc-300 hover:text-red-500 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

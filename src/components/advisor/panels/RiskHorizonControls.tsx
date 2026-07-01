'use client';
import React from 'react';
import clsx from 'clsx';
import type { RiskProfile, TimeHorizon } from './types';

export function RiskHorizonControls({ riskProfile, setRiskProfile, timeHorizon, setTimeHorizon }: {
  riskProfile: RiskProfile; setRiskProfile: (r: RiskProfile) => void;
  timeHorizon: TimeHorizon; setTimeHorizon: (h: TimeHorizon) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-6">
      <div>
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Risk Profile</p>
        <div className="flex gap-2">
          {(['Conservative', 'Moderate', 'Aggressive'] as RiskProfile[]).map(r => (
            <button key={r} onClick={() => setRiskProfile(r)}
              className={clsx('px-4 py-2 rounded-xl text-xs font-semibold border transition-all',
                riskProfile === r ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-zinc-600 border-zinc-200 hover:border-orange-300'
              )}
            >{r}</button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Time Horizon</p>
        <div className="flex gap-2">
          {(['6 months', '1 year', '3-5 years', '10 years'] as TimeHorizon[]).map(h => (
            <button key={h} onClick={() => setTimeHorizon(h)}
              className={clsx('px-3 py-2 rounded-xl text-xs font-semibold border transition-all',
                timeHorizon === h ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-zinc-600 border-zinc-200 hover:border-orange-300'
              )}
            >{h}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

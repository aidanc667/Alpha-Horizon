'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import type { IntakeAnswers } from '@/lib/agents/types';
import { US_STATES } from '@/apps/portfolio-agent/constants';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onComplete: (answers: IntakeAnswers) => void;
}

// ─── Draft (intermediate state, looser types for in-progress inputs) ──────────

interface Draft {
  primaryGoal?: 'financial_independence' | 'max_growth' | 'legacy' | 'capital_preservation';
  goalAmount?: number;
  yearsUntilWithdrawal?: number;
  startingCapital?: number;
  monthlyContribution?: number;
  annualIncome?: number;
  taxFilingStatus: 'single' | 'mfj' | 'mfs' | 'hoh';
  state: string;
  incomeStability?: 1 | 2 | 3 | 4 | 5;
  emergencyFundStatus?: 'none' | '1_2mo' | '3mo' | '6mo_plus';
  majorExpenseType?: string;
  largeExpenseCost?: number;
  debtLevel?: 'none' | 'low' | 'medium' | 'high';
  accounts: string[];
  marketDropReactionIdx?: number;
  marketDropReaction?: 'panic' | 'passive' | 'aggressive';
  investmentExperience?: 'beginner' | 'some' | 'experienced' | 'sophisticated';
  constraints: string[];
}

const INITIAL: Draft = {
  taxFilingStatus: 'single',
  state: 'CA',
  accounts: [],
  constraints: [],
};

// ─── Steps ────────────────────────────────────────────────────────────────────

const STEPS = [
  { label: 'Goal + Timeline',  subtitle: 'What is your primary investment goal?' },
  { label: 'Capital',          subtitle: 'What can you invest?' },
  { label: 'Income + Tax',     subtitle: 'Your income and tax situation' },
  { label: 'Cash Foundation',  subtitle: 'Your cash cushion and debt situation' },
  { label: 'Major Expenses',   subtitle: 'Any large purchases coming up?' },
  { label: 'Accounts',         subtitle: 'Which investment accounts do you have or can access?' },
  { label: 'Risk DNA',         subtitle: 'How do you handle volatility?' },
  { label: 'Constraints',      subtitle: 'Any investment restrictions? (optional — skip to continue)' },
] as const;

// ─── Motion ───────────────────────────────────────────────────────────────────

const variants = {
  enter:  (dir: number) => ({ x: dir > 0 ? 56 : -56, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit:   (dir: number) => ({ x: dir > 0 ? -56 : 56, opacity: 0 }),
};
const transition = { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: number | undefined): string {
  return n !== undefined ? n.toLocaleString('en-US') : '';
}

function parseNum(raw: string): number | undefined {
  const stripped = raw.replace(/[^0-9]/g, '');
  if (!stripped) return undefined;
  return Number(stripped);
}

function canAdvance(step: number, d: Draft): boolean {
  switch (step) {
    case 0:
      if (!d.primaryGoal || !d.yearsUntilWithdrawal || d.yearsUntilWithdrawal <= 0) return false;
      if (d.primaryGoal === 'max_growth' && !d.goalAmount) return false;
      return true;
    case 1: return d.startingCapital !== undefined && d.monthlyContribution !== undefined;
    case 2: return !!(d.annualIncome !== undefined && d.incomeStability);
    case 3: return !!(d.emergencyFundStatus && d.debtLevel);
    case 4: return !!d.majorExpenseType;
    case 5: return true;
    case 6: return !!(d.marketDropReaction && d.investmentExperience);
    case 7: return true;
    default: return false;
  }
}

function buildAnswers(d: Draft): IntakeAnswers {
  const active = d.constraints.filter(c => c !== 'no_restrictions');
  const favored: string[] = [];
  const avoided: string[] = [];
  if (active.includes('esg'))           favored.push('ESG');
  if (active.includes('reits'))         favored.push('real_estate');
  if (active.includes('simplicity'))    favored.push('simplicity');
  if (active.includes('avoid_sectors')) avoided.push('tobacco,weapons,fossil_fuels');
  if (active.includes('us_only'))       avoided.push('international');

  let goalAmount = d.goalAmount;
  if (!goalAmount) {
    if (d.primaryGoal === 'financial_independence' || d.primaryGoal === 'legacy') {
      goalAmount = (d.annualIncome ?? 0) * 10;
    } else if (d.primaryGoal === 'capital_preservation') {
      goalAmount = Math.round((d.startingCapital ?? 0) * Math.pow(1.025, d.yearsUntilWithdrawal ?? 10));
    }
  }

  const filingMap = {
    single: 'single',
    mfj:    'married_filing_jointly',
    mfs:    'married_filing_separately',
    hoh:    'head_of_household',
  } as const;

  const riskWillingnessMap = {
    panic:      'low',
    passive:    'medium',
    aggressive: 'high',
  } as const;

  const stability = d.incomeStability ?? 3;
  const hasEmergencyFund = d.emergencyFundStatus !== 'none' && !!d.emergencyFundStatus;
  const riskCapacity =
    stability >= 4 && hasEmergencyFund ? 'high' :
    stability <= 2 && !hasEmergencyFund ? 'low' :
    'medium';

  const hasLargeExpense = !!(d.majorExpenseType && d.majorExpenseType !== 'none');

  return {
    goal:               d.primaryGoal!,
    goalAmount,
    timeHorizon:        d.yearsUntilWithdrawal!,
    startingCapital:    d.startingCapital!,
    monthlyContribution: d.monthlyContribution!,
    financialSnapshot: {
      hasEmergencyFund,
      hasHighInterestDebt: d.debtLevel === 'high',
      ...(hasLargeExpense && d.largeExpenseCost ? { plannedExpense: d.largeExpenseCost } : {}),
    },
    filingStatus:       filingMap[d.taxFilingStatus],
    annualIncome:       d.annualIncome!,
    state:              d.state,
    age:                35,
    existingAccounts:   { traditional: 0, roth: 0, hsa: 0 },
    riskCapacity,
    riskWillingness:    riskWillingnessMap[d.marketDropReaction ?? 'passive'],
    incomeStability:    d.incomeStability!,
    availableAccounts:  d.accounts,
    investmentPreferences: {
      ...(favored.length ? { favoredSectors: favored.join(',') } : {}),
      ...(avoided.length ? { avoidedSectors: avoided.join(',') } : {}),
      esgOnly: active.includes('esg'),
      experienceLevel: d.investmentExperience,
    },
  };
}

// ─── Shared atoms ─────────────────────────────────────────────────────────────

function MoneyInput({
  label, value, placeholder, onChange,
}: {
  label: string; value: number | undefined; placeholder: string;
  onChange: (n: number | undefined) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-mono uppercase tracking-widest text-gray-500">{label}</label>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-mono text-lg pointer-events-none">$</span>
        <input
          type="text" inputMode="numeric"
          placeholder={placeholder}
          value={fmtNum(value)}
          onChange={e => onChange(parseNum(e.target.value))}
          className="w-full pl-8 pr-4 py-3 bg-gray-50 border border-gray-200 focus:border-emerald-500/60 rounded-xl outline-none font-mono text-xl font-bold text-gray-900 placeholder-gray-300 transition-colors"
        />
      </div>
    </div>
  );
}

function RadioBtn({
  selected, onClick, children,
}: {
  selected: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-xl border transition-all flex items-center justify-between ${
        selected
          ? 'bg-emerald-500/10 border-emerald-500/50'
          : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-emerald-400/40 hover:bg-emerald-500/5'
      }`}
    >
      {children}
      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ml-3 transition-all ${selected ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'}`}>
        {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </div>
    </button>
  );
}

function CheckBtn({
  selected, onClick, children,
}: {
  selected: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-xl border transition-all flex items-center justify-between ${
        selected
          ? 'bg-emerald-500/10 border-emerald-500/50'
          : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-emerald-400/40 hover:bg-emerald-500/5'
      }`}
    >
      {children}
      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ml-3 transition-all ${selected ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'}`}>
        {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </div>
    </button>
  );
}

// ─── Step renders ─────────────────────────────────────────────────────────────

const GOALS: Array<{ value: Draft['primaryGoal']; label: string; desc: string }> = [
  { value: 'financial_independence', label: '💰 Retirement / Financial Independence', desc: "Build a portfolio that replaces your income — we'll target 25× your annual spending" },
  { value: 'max_growth',             label: '📈 Wealth Accumulation',                 desc: 'Grow to a specific dollar target you define' },
  { value: 'capital_preservation',   label: '🛡️ Capital Preservation',               desc: 'Protect and grow existing wealth with minimal drawdown' },
  { value: 'legacy',                 label: '🏛️ Passive Income / Legacy',             desc: 'Generate cash flow or build generational wealth' },
];

const STABILITY: Array<{ value: Draft['incomeStability']; label: string }> = [
  { value: 5, label: 'Very Stable — government, tenured, long-term contract' },
  { value: 4, label: 'Stable — salaried corporate employee' },
  { value: 3, label: 'Variable — freelance, commission, self-employed' },
  { value: 2, label: 'Business Owner — variable revenue' },
  { value: 1, label: 'In Transition or Uncertain' },
];

const EMERGENCY = [
  { value: 'none',     label: 'None — no dedicated emergency fund' },
  { value: '1_2mo',   label: '1–2 months of expenses saved' },
  { value: '3mo',     label: '3 months (standard recommendation)' },
  { value: '6mo_plus', label: '6+ months — well cushioned' },
] as const;

const MAJOR_EXPENSE = [
  { value: 'none',      label: 'No major purchases planned' },
  { value: 'home',      label: 'Home / Real Estate Purchase' },
  { value: 'business',  label: 'Business Investment or Startup' },
  { value: 'education', label: 'Education (self or dependent)' },
  { value: 'other',     label: 'Other Major Expense' },
] as const;

const DEBT = [
  { value: 'none',   label: 'No significant debt' },
  { value: 'low',    label: 'Under $10K — manageable' },
  { value: 'medium', label: '$10K–$50K' },
  { value: 'high',   label: 'Over $50K — high leverage' },
] as const;

const ACCOUNTS_LIST = [
  'Workplace 401(k) / 403(b)',
  'Roth IRA',
  'Traditional IRA',
  'HSA (Health Savings Account)',
  '529 College Savings',
  'Solo 401(k) / SEP-IRA',
  'None — taxable brokerage only',
];

const REACTIONS: Array<{ label: string; value: Draft['marketDropReaction'] }> = [
  { label: 'Sell everything — preserving capital is critical',       value: 'panic'      },
  { label: 'Reduce exposure — large losses make me uncomfortable',   value: 'panic'      },
  { label: 'Hold steady — I trust the long-term plan',               value: 'passive'    },
  { label: 'Buy more — I see downturns as buying opportunities',     value: 'aggressive' },
  { label: 'Rebalance to target — sell what held up, buy what fell', value: 'aggressive' },
];

const EXPERIENCE: Array<{ value: Draft['investmentExperience']; label: string; desc: string }> = [
  { value: 'beginner',      label: 'First-time investor',       desc: 'Never managed an investment portfolio' },
  { value: 'some',          label: 'Some experience (1–3 yrs)', desc: 'Have a 401k or basic brokerage account' },
  { value: 'experienced',   label: 'Experienced (3–10 yrs)',    desc: 'Comfortable with ETFs, rebalancing, and taxes' },
  { value: 'sophisticated', label: 'Sophisticated (10+ yrs)',   desc: 'Factor investing, tax-loss harvesting, options' },
];

const CONSTRAINTS = [
  { value: 'esg',           label: 'ESG / Sustainable focus' },
  { value: 'avoid_sectors', label: 'Avoid tobacco, weapons, fossil fuels' },
  { value: 'us_only',       label: 'US-only (no international ETFs)' },
  { value: 'simplicity',    label: 'Maximum simplicity (3 ETFs max)' },
  { value: 'reits',         label: 'Include REITs / real estate' },
  { value: 'no_restrictions', label: 'No restrictions' },
];

const FILING: Array<{ value: Draft['taxFilingStatus']; label: string }> = [
  { value: 'single', label: 'Single' },
  { value: 'mfj',    label: 'Married Filing Jointly' },
  { value: 'mfs',    label: 'Married Filing Separately' },
  { value: 'hoh',    label: 'Head of Household' },
];

function renderStep(step: number, draft: Draft, update: (k: keyof Draft, v: unknown) => void) {
  switch (step) {
    // ── Q1: Goal + Timeline + Target ───────────────────────────────────────────
    case 0: return (
      <div className="space-y-5">
        <div className="space-y-2">
          {GOALS.map(g => (
            <button
              key={g.value}
              onClick={() => update('primaryGoal', g.value)}
              className={`w-full text-left px-4 py-3.5 rounded-xl border transition-all ${
                draft.primaryGoal === g.value
                  ? 'bg-emerald-500/10 border-emerald-500/50'
                  : 'bg-gray-50 border-gray-200 hover:border-emerald-400/40 hover:bg-emerald-500/5'
              }`}
            >
              <div className={`text-sm font-semibold ${draft.primaryGoal === g.value ? 'text-emerald-700' : 'text-gray-800'}`}>{g.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{g.desc}</div>
            </button>
          ))}
        </div>
        <div className={`grid gap-3 ${(draft.primaryGoal === 'financial_independence' || draft.primaryGoal === 'max_growth') ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase tracking-widest text-gray-500">Years Until Withdrawal</label>
            <div className="relative">
              <input
                type="text" inputMode="numeric" placeholder="e.g. 20"
                value={draft.yearsUntilWithdrawal ?? ''}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '');
                  update('yearsUntilWithdrawal', v === '' ? undefined : Number(v));
                }}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-emerald-500/60 rounded-xl outline-none font-mono text-xl font-bold text-gray-900 placeholder-gray-300 transition-colors pr-12"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 uppercase tracking-widest pointer-events-none">yrs</span>
            </div>
          </div>
          {(draft.primaryGoal === 'financial_independence' || draft.primaryGoal === 'max_growth') && (
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase tracking-widest text-gray-500">
                Target Amount{' '}
                {draft.primaryGoal === 'financial_independence'
                  ? <span className="normal-case font-normal text-gray-400">(optional)</span>
                  : <span className="normal-case font-normal text-red-400">*required</span>}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-mono pointer-events-none">$</span>
                <input
                  type="text" inputMode="numeric" placeholder="1,000,000"
                  value={fmtNum(draft.goalAmount)}
                  onChange={e => update('goalAmount', parseNum(e.target.value))}
                  className="w-full pl-7 pr-4 py-3 bg-gray-50 border border-gray-200 focus:border-emerald-500/60 rounded-xl outline-none font-mono text-xl font-bold text-gray-900 placeholder-gray-300 transition-colors"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );

    // ── Q2: Capital ────────────────────────────────────────────────────────────
    case 1: return (
      <div className="space-y-4">
        <MoneyInput
          label="Starting Lump Sum Today"
          value={draft.startingCapital}
          placeholder="50,000"
          onChange={v => update('startingCapital', v)}
        />
        <MoneyInput
          label="Monthly Investing Amount Going Forward"
          value={draft.monthlyContribution}
          placeholder="1,500"
          onChange={v => update('monthlyContribution', v)}
        />
      </div>
    );

    // ── Q3: Income + Tax + Stability ───────────────────────────────────────────
    case 2: return (
      <div className="space-y-4">
        <MoneyInput
          label="Estimated Annual Gross Income"
          value={draft.annualIncome}
          placeholder="120,000"
          onChange={v => update('annualIncome', v)}
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase tracking-widest text-gray-500">Tax Filing Status</label>
            <select
              value={draft.taxFilingStatus}
              onChange={e => update('taxFilingStatus', e.target.value as Draft['taxFilingStatus'])}
              className="w-full px-3 py-3 bg-gray-50 border border-gray-200 focus:border-emerald-500/60 rounded-xl outline-none text-sm font-medium text-gray-800 appearance-none cursor-pointer transition-colors"
            >
              {FILING.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-mono uppercase tracking-widest text-gray-500">State of Residence</label>
            <select
              value={draft.state}
              onChange={e => update('state', e.target.value)}
              className="w-full px-3 py-3 bg-gray-50 border border-gray-200 focus:border-emerald-500/60 rounded-xl outline-none text-sm font-medium text-gray-800 appearance-none cursor-pointer transition-colors"
            >
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-mono uppercase tracking-widest text-gray-500">Income Stability</label>
          <div className="space-y-2">
            {STABILITY.map(s => (
              <RadioBtn key={s.value} selected={draft.incomeStability === s.value} onClick={() => update('incomeStability', s.value)}>
                <span className={`text-sm font-medium ${draft.incomeStability === s.value ? 'text-emerald-700' : ''}`}>{s.label}</span>
              </RadioBtn>
            ))}
          </div>
        </div>
      </div>
    );

    // ── Q4: Cash Foundation ────────────────────────────────────────────────────
    case 3: return (
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-xs font-mono uppercase tracking-widest text-gray-500">Emergency Fund Status</label>
          <div className="space-y-2">
            {EMERGENCY.map(e => (
              <RadioBtn key={e.value} selected={draft.emergencyFundStatus === e.value} onClick={() => update('emergencyFundStatus', e.value)}>
                <span className={`text-sm font-medium ${draft.emergencyFundStatus === e.value ? 'text-emerald-700' : ''}`}>{e.label}</span>
              </RadioBtn>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-mono uppercase tracking-widest text-gray-500">Current Debt Level</label>
          <div className="space-y-2">
            {DEBT.map(d => (
              <RadioBtn key={d.value} selected={draft.debtLevel === d.value} onClick={() => update('debtLevel', d.value)}>
                <span className={`text-sm font-medium ${draft.debtLevel === d.value ? 'text-emerald-700' : ''}`}>{d.label}</span>
              </RadioBtn>
            ))}
          </div>
        </div>
      </div>
    );

    // ── Q5: Major Expenses ─────────────────────────────────────────────────────
    case 4: return (
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-xs font-mono uppercase tracking-widest text-gray-500">Major Expense in Next 5 Years</label>
          <div className="space-y-2">
            {MAJOR_EXPENSE.map(e => (
              <RadioBtn key={e.value} selected={draft.majorExpenseType === e.value} onClick={() => update('majorExpenseType', e.value)}>
                <span className={`text-sm font-medium ${draft.majorExpenseType === e.value ? 'text-emerald-700' : ''}`}>{e.label}</span>
              </RadioBtn>
            ))}
          </div>
          {draft.majorExpenseType && draft.majorExpenseType !== 'none' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
              className="overflow-hidden mt-2"
            >
              <div className="p-3 bg-gray-100 rounded-xl">
                <MoneyInput
                  label="Estimated Cost (optional)"
                  value={draft.largeExpenseCost}
                  placeholder="80,000"
                  onChange={v => update('largeExpenseCost', v)}
                />
              </div>
            </motion.div>
          )}
        </div>
      </div>
    );

    // ── Q6: Accounts ───────────────────────────────────────────────────────────
    case 5: {
      const toggleAcct = (acct: string) => {
        const NONE = 'None — taxable brokerage only';
        if (acct === NONE) {
          update('accounts', draft.accounts.includes(NONE) ? [] : [NONE]);
          return;
        }
        const without = draft.accounts.filter(a => a !== NONE);
        const next = without.includes(acct)
          ? without.filter(a => a !== acct)
          : [...without, acct];
        update('accounts', next);
      };
      return (
        <div className="space-y-2">
          {ACCOUNTS_LIST.map(acct => (
            <div key={acct}>
              <CheckBtn selected={draft.accounts.includes(acct)} onClick={() => toggleAcct(acct)}>
                <span className={`text-sm font-medium ${draft.accounts.includes(acct) ? 'text-emerald-700' : ''}`}>{acct}</span>
              </CheckBtn>
              {acct === 'Workplace 401(k) / 403(b)' && draft.accounts.includes(acct) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 ml-3 p-3 bg-gray-100 rounded-xl border-l-2 border-emerald-400/60 space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-mono uppercase tracking-widest text-gray-500">Employer Match %</label>
                      <input
                        type="text" inputMode="decimal" placeholder="e.g. 4"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg outline-none text-sm font-mono font-bold text-gray-800 placeholder-gray-300 focus:border-emerald-500/60 transition-colors"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-mono uppercase tracking-widest text-gray-500">Roth 401(k) Option Available?</label>
                      <div className="flex gap-2">
                        {['Yes', 'No'].map(o => (
                          <button key={o} className="flex-1 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-bold text-gray-600 hover:border-emerald-400/60 transition-colors">
                            {o}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          ))}
        </div>
      );
    }

    // ── Q7: Risk DNA ───────────────────────────────────────────────────────────
    case 6: return (
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-xs font-mono uppercase tracking-widest text-gray-500">
            If your portfolio dropped 25%, what would you do?
          </label>
          <div className="space-y-2">
            {REACTIONS.map((r, i) => (
              <RadioBtn
                key={i}
                selected={draft.marketDropReactionIdx === i}
                onClick={() => { update('marketDropReactionIdx', i); update('marketDropReaction', r.value); }}
              >
                <span className={`text-sm font-medium ${draft.marketDropReactionIdx === i ? 'text-emerald-700' : ''}`}>{r.label}</span>
              </RadioBtn>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-mono uppercase tracking-widest text-gray-500">Investment Experience</label>
          <div className="space-y-2">
            {EXPERIENCE.map(e => (
              <button
                key={e.value}
                onClick={() => update('investmentExperience', e.value)}
                className={`w-full text-left px-4 py-3.5 rounded-xl border transition-all ${
                  draft.investmentExperience === e.value
                    ? 'bg-emerald-500/10 border-emerald-500/50'
                    : 'bg-gray-50 border-gray-200 hover:border-emerald-400/40 hover:bg-emerald-500/5'
                }`}
              >
                <div className={`text-sm font-semibold ${draft.investmentExperience === e.value ? 'text-emerald-700' : 'text-gray-800'}`}>{e.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{e.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );

    // ── Q8: Constraints ────────────────────────────────────────────────────────
    case 7: {
      const toggleConstraint = (val: string) => {
        if (val === 'no_restrictions') {
          update('constraints', draft.constraints.includes('no_restrictions') ? [] : ['no_restrictions']);
          return;
        }
        const without = draft.constraints.filter(c => c !== 'no_restrictions');
        const next = without.includes(val)
          ? without.filter(c => c !== val)
          : [...without, val];
        update('constraints', next);
      };
      return (
        <div className="space-y-2">
          {CONSTRAINTS.map(c => (
            <CheckBtn key={c.value} selected={draft.constraints.includes(c.value)} onClick={() => toggleConstraint(c.value)}>
              <span className={`text-sm font-medium ${draft.constraints.includes(c.value) ? 'text-emerald-700' : ''}`}>{c.label}</span>
            </CheckBtn>
          ))}
        </div>
      );
    }

    default: return null;
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OnboardingFlow({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [dir, setDir]   = useState(1);
  const [draft, setDraft] = useState<Draft>(INITIAL);

  const update = (k: keyof Draft, v: unknown) =>
    setDraft(prev => ({ ...prev, [k]: v }));

  const goNext = () => {
    if (step < STEPS.length - 1) {
      setDir(1);
      setStep(s => s + 1);
    } else {
      onComplete(buildAnswers(draft));
    }
  };

  const goBack = () => {
    if (step > 0) {
      setDir(-1);
      setStep(s => s - 1);
    }
  };

  const ok = canAdvance(step, draft);
  const isLast = step === STEPS.length - 1;
  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <div className="p-6 space-y-6">
      {/* Progress header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <button
            onClick={goBack}
            disabled={step === 0}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 disabled:opacity-25"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 text-xs font-mono text-gray-500">
            <span className="uppercase tracking-widest">Question {step + 1} of {STEPS.length}</span>
          </div>
        </div>
        <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-emerald-500 rounded-full"
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          />
        </div>
        <p className="text-xs font-mono text-gray-400 uppercase tracking-widest">{STEPS[step].label}</p>
      </div>

      {/* Question title */}
      <AnimatePresence mode="wait" custom={dir}>
        <motion.div
          key={step}
          custom={dir}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={transition}
          className="space-y-5"
        >
          <p className="text-base text-gray-500">{STEPS[step].subtitle}</p>
          {renderStep(step, draft, update)}
        </motion.div>
      </AnimatePresence>

      {/* Next / Submit button */}
      <div className="pt-1">
        <button
          onClick={goNext}
          disabled={!ok}
          className="w-full flex items-center justify-center gap-2 py-3.5 px-6 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-100 disabled:text-gray-300 text-white rounded-xl font-semibold text-sm transition-all active:scale-[0.98]"
        >
          {isLast ? 'Build My Portfolio' : 'Continue'}
          <ChevronRight className="w-4 h-4" />
        </button>
        {isLast && (
          <p className="text-center text-xs text-gray-400 mt-2">
            Step 7 is optional — click Continue to skip restrictions
          </p>
        )}
      </div>
    </div>
  );
}

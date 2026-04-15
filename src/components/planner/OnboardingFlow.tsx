'use client';

import React, { useState } from 'react';
import { ChevronRight, ChevronLeft, Check, Sparkles } from 'lucide-react';
import type { OnboardingResponses } from '@/types';

interface Question {
  id: string;
  text: string;
  type: 'text' | 'number' | 'select' | 'multi' | 'composite' | 'composite_goal' | 'composite_age' | 'composite_monthly' | 'select_conditional';
  options?: string[];
  fields?: string[];
  placeholder?: string;
  section: string;
}

const QUESTIONS: Question[] = [
  {
    id: 'primaryGoal',
    section: 'Financial Goals',
    text: 'What is Your Primary Financial Goal?',
    type: 'select',
    options: [
      'Retirement / Financial Independence',
      'Maximum Long-Term Growth',
      'Save for a Major Purchase',
      'Generate Passive Income / Cash Flow',
      'Capital Preservation / Safety',
    ],
  },
  {
    id: 'goalDetails',
    section: 'Financial Goals',
    text: 'What is Your Target Amount and Investment Horizon?',
    type: 'composite_goal',
  },
  {
    id: 'ageProfile',
    section: 'Personal Profile',
    text: 'What is Your Age Profile?',
    type: 'composite_age',
  },
  {
    id: 'taxAndIncome',
    section: 'Tax & Income',
    text: 'What is Your Tax & Income Profile?',
    type: 'composite',
  },
  {
    id: 'startingAmount',
    section: 'Current Status',
    text: 'How Much Can You Invest Right Now? (Starting Lump Sum)',
    type: 'number',
    placeholder: 'Starting $',
  },
  {
    id: 'monthlyFinances',
    section: 'Current Status',
    text: 'What is Your Monthly Finances Profile?',
    type: 'composite_monthly',
  },
  {
    id: 'employmentStability',
    section: 'Financial Stability',
    text: 'How Stable is Your Primary Income Source?',
    type: 'select',
    options: [
      'Very Stable (government, tenured, long-term contract)',
      'Stable (salaried corporate employee)',
      'Moderate (freelance, variable commission, hourly)',
      'Variable (self-employed, business owner)',
      'Currently in Transition or Uncertain',
    ],
  },
  {
    id: 'majorExpense',
    section: 'Financial Goals',
    text: 'Do You Have Any Large Planned Expenses in the Next 5 Years?',
    type: 'select_conditional',
    options: [
      'No major purchases planned',
      'Home / Real Estate Purchase',
      'Business Investment or Startup',
      'Education (Self or Dependent)',
      'Major Life Event (wedding, relocation)',
      'Other Major Purchase',
    ],
  },
  {
    id: 'riskThreshold',
    section: 'Risk Profile',
    text: "If Your Portfolio Dropped 25% in One Year, What Would You Do?",
    type: 'select',
    options: [
      'Sell everything — preserving capital is critical',
      'Reduce exposure — large losses make me uncomfortable',
      'Hold steady — I trust the long-term plan',
      'Invest more — I see downturns as buying opportunities',
      'Rebalance to target — sell what held up, buy what fell, restore my allocation',
    ],
  },
  {
    id: 'taxAdvantagedAccounts',
    section: 'Tax Optimization',
    text: 'Which Tax-Advantaged Accounts Do You Have or Can Get Access To?',
    type: 'multi',
    fields: [
      'Workplace Retirement Plan (401k / 403b)',
      'Roth IRA',
      'Traditional IRA',
      'Health Savings Account (HSA)',
      'Government 457(b) Plan',
      'Mega Backdoor Roth (After-Tax 401k)',
      'Self-Employed Plan (Solo 401k / SEP-IRA)',
      '529 College Savings Plan',
      'None of the above',
    ],
  },
];

interface Props {
  onComplete: (responses: OnboardingResponses) => void;
  isLoading: boolean;
}

export default function OnboardingFlow({ onComplete, isLoading }: Props) {
  const [step, setStep] = useState(0);
  const [responses, setResponses] = useState<OnboardingResponses>({ state: 'CA', taxFilingStatus: 'Single' });
  const [inputValue, setInputValue] = useState('');
  const [multiValue, setMultiValue] = useState<Record<string, boolean>>({});

  const question = QUESTIONS[step];

  const handleBack = () => {
    if (step > 0) { setStep(s => s - 1); setInputValue(''); }
  };

  const advance = (newResponses: OnboardingResponses) => {
    const next = step + 1;
    if (next < QUESTIONS.length) {
      setStep(next); setInputValue(''); setMultiValue({});
    } else {
      onComplete(newResponses);
    }
  };

  const handleNumberChange = (raw: string) => {
    const stripped = raw.replace(/,/g, '');
    if (stripped === '' || /^\d*$/.test(stripped)) {
      setInputValue(stripped === '' ? '' : Number(stripped).toLocaleString('en-US'));
    }
  };

  // For number fields stored directly in responses (composite sub-fields)
  const handleResponseCommaNumber = (raw: string, key: string) => {
    const stripped = raw.replace(/,/g, '');
    if (stripped === '' || /^\d*$/.test(stripped)) {
      setResponses(r => ({ ...r, [key]: stripped === '' ? '' : Number(stripped).toLocaleString('en-US') }));
    }
  };

  const handleNext = () => {
    // Composite types: data already stored in responses via inline onChange
    if (
      question.type === 'composite' ||
      question.type === 'composite_goal' ||
      question.type === 'composite_age' ||
      question.type === 'composite_monthly' ||
      question.type === 'select_conditional'
    ) {
      advance(responses);
      return;
    }
    let val: any = question.type === 'number' ? inputValue.replace(/,/g, '') : inputValue;
    if (question.type === 'multi') val = Object.keys(multiValue).filter(k => multiValue[k]);
    const nr = { ...responses, [question.id]: val };
    setResponses(nr);
    advance(nr);
  };

  const handleSelect = (opt: string) => {
    setInputValue(opt);
    setTimeout(() => {
      const nr = { ...responses, [question.id]: opt };
      setResponses(nr);
      advance(nr);
    }, 150);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-6 p-8">
        <div className="relative">
          <div className="w-16 h-16 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-emerald-500" />
          </div>
        </div>
        <div className="text-center space-y-2">
          <p className="text-base font-bold text-gray-900">Analyzing Financial DNA...</p>
          <p className="text-sm text-gray-600">Building your institutional-grade strategy.</p>
        </div>
      </div>
    );
  }

  const canProceed = (() => {
    switch (question.type) {
      case 'composite':
        return !!(responses.taxFilingStatus && String(responses.annualIncome || '').trim());
      case 'composite_goal':
        return !!(String(responses.goalAmount || '').trim() && String(responses.timeline || '').trim());
      case 'composite_age':
        return !!String(responses.currentAge || '').trim();
      case 'composite_monthly':
        return !!(String(responses.monthlyExpenses || '').trim() && String(responses.monthlyContribution || '').trim());
      case 'select_conditional':
        return !!responses.majorExpense;
      case 'multi':
        return true;
      default:
        return !!inputValue.trim();
    }
  })();

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <button onClick={handleBack} disabled={step === 0}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-600 hover:text-gray-700 disabled:opacity-30">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-gray-600 uppercase tracking-widest">
              {step + 1} / {QUESTIONS.length}
            </span>
            <span className="text-xs font-mono text-emerald-500 font-bold">
              {Math.round(((step + 1) / QUESTIONS.length) * 100)}%
            </span>
          </div>
        </div>
        <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all duration-500 ease-out rounded-full"
            style={{ width: `${((step + 1) / QUESTIONS.length) * 100}%` }} />
        </div>
        <p className="text-xs font-mono text-gray-600 uppercase tracking-widest">{question.section}</p>
      </div>

      {/* Question */}
      <h3 className="text-lg font-bold text-gray-900 leading-snug">{question.text}</h3>

      {/* Inputs */}
      <div className="space-y-3">

        {/* ── SELECT ── */}
        {question.type === 'select' && (
          <div className="space-y-2">
            {question.options?.map(opt => (
              <button key={opt} onClick={() => handleSelect(opt)}
                className="w-full text-left px-4 py-3 rounded-xl bg-gray-100 border border-gray-200 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-all flex items-center justify-between group">
                <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900">{opt}</span>
                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-emerald-500 transition-colors" />
              </button>
            ))}
          </div>
        )}

        {/* ── SELECT CONDITIONAL (major expense) ── */}
        {question.type === 'select_conditional' && (
          <div className="space-y-2">
            {question.options?.map(opt => (
              <button key={opt}
                onClick={() => setResponses(r => ({ ...r, majorExpense: opt }))}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all flex items-center justify-between ${
                  responses.majorExpense === opt
                    ? 'bg-emerald-500/10 border-emerald-500/40'
                    : 'bg-gray-100 border-gray-200 hover:border-emerald-500/40 hover:bg-emerald-500/5'
                }`}>
                <span className={`text-sm font-medium ${responses.majorExpense === opt ? 'text-emerald-700' : 'text-gray-700'}`}>{opt}</span>
                {responses.majorExpense === opt
                  ? <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  : <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />}
              </button>
            ))}
            {/* Conditional cost input */}
            {responses.majorExpense && responses.majorExpense !== 'No major purchases planned' && (
              <div className="mt-3 p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-1.5 animate-fade-in">
                <label className="text-xs font-mono uppercase text-gray-600 tracking-widest">
                  Estimated Cost (optional)
                </label>
                <input
                  type="text" inputMode="numeric"
                  placeholder="Estimated $"
                  value={responses.majorExpenseCost as string || ''}
                  onChange={e => handleResponseCommaNumber(e.target.value, 'majorExpenseCost')}
                  className="w-full bg-white border border-gray-200 focus:border-emerald-500/60 outline-none rounded-xl px-4 py-3 text-2xl font-mono font-bold text-gray-900 placeholder-gray-400 transition-colors"
                />
              </div>
            )}
          </div>
        )}

        {/* ── NUMBER ── */}
        {question.type === 'number' && (
          <div className="relative">
            <input autoFocus type="text" inputMode="numeric" value={inputValue}
              onChange={e => handleNumberChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && inputValue.trim() && handleNext()}
              placeholder={question.placeholder}
              className="w-full bg-gray-100 border border-gray-200 focus:border-emerald-500/60 outline-none rounded-xl px-4 py-3 text-2xl font-mono font-bold text-gray-900 placeholder-gray-400 transition-colors"
            />
          </div>
        )}

        {/* ── COMPOSITE: Tax & Income ── */}
        {question.type === 'composite' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase text-gray-600 tracking-widest">Tax Filing Status</label>
              <select value={responses.taxFilingStatus as string || 'Single'}
                onChange={e => setResponses({ ...responses, taxFilingStatus: e.target.value })}
                className="w-full bg-gray-100 border border-gray-200 focus:border-emerald-500/60 outline-none rounded-xl px-4 py-3 text-sm font-medium text-gray-900 appearance-none cursor-pointer transition-colors">
                {['Single','Married Filing Jointly','Married Filing Separately','Head of Household','Qualifying Surviving Spouse'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase text-gray-600 tracking-widest">Estimated Annual Income</label>
              <input type="text" inputMode="numeric" placeholder="Annual Income $"
                value={responses.annualIncome as string || ''}
                onChange={e => handleResponseCommaNumber(e.target.value, 'annualIncome')}
                className="w-full bg-gray-100 border border-gray-200 focus:border-emerald-500/60 outline-none rounded-xl px-4 py-3 text-2xl font-mono font-bold text-gray-900 placeholder-gray-400 transition-colors"
              />
            </div>
          </div>
        )}

        {/* ── COMPOSITE: Goal Details (amount + timeline) ── */}
        {question.type === 'composite_goal' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase text-gray-600 tracking-widest">Target Portfolio Amount</label>
              <input type="text" inputMode="numeric" placeholder="Target $"
                value={responses.goalAmount as string || ''}
                onChange={e => handleResponseCommaNumber(e.target.value, 'goalAmount')}
                className="w-full bg-gray-100 border border-gray-200 focus:border-emerald-500/60 outline-none rounded-xl px-4 py-3 text-2xl font-mono font-bold text-gray-900 placeholder-gray-400 transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase text-gray-600 tracking-widest">Investment Timeline</label>
              <div className="relative">
                <input type="text" inputMode="numeric" placeholder="0"
                  value={responses.timeline as string || ''}
                  onChange={e => {
                    if (e.target.value === '' || /^\d*$/.test(e.target.value))
                      setResponses(r => ({ ...r, timeline: e.target.value }));
                  }}
                  className="w-full bg-gray-100 border border-gray-200 focus:border-emerald-500/60 outline-none rounded-xl px-4 py-3 text-2xl font-mono font-bold text-gray-900 placeholder-gray-400 transition-colors pr-20"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-600 uppercase tracking-widest pointer-events-none">years</span>
              </div>
            </div>
          </div>
        )}

        {/* ── COMPOSITE: Age Profile (current age + retirement age) ── */}
        {question.type === 'composite_age' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase text-gray-600 tracking-widest">Current Age</label>
              <div className="relative">
                <input type="text" inputMode="numeric" placeholder="e.g. 32"
                  value={responses.currentAge as string || ''}
                  onChange={e => {
                    if (e.target.value === '' || /^\d{0,3}$/.test(e.target.value))
                      setResponses(r => ({ ...r, currentAge: e.target.value }));
                  }}
                  className="w-full bg-gray-100 border border-gray-200 focus:border-emerald-500/60 outline-none rounded-xl px-4 py-3 text-2xl font-mono font-bold text-gray-900 placeholder-gray-400 transition-colors pr-20"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-600 uppercase tracking-widest pointer-events-none">yrs old</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase text-gray-600 tracking-widest">Target Retirement Age <span className="normal-case font-normal text-gray-400">(optional)</span></label>
              <div className="relative">
                <input type="text" inputMode="numeric" placeholder="e.g. 65"
                  value={responses.retirementAge as string || ''}
                  onChange={e => {
                    if (e.target.value === '' || /^\d{0,3}$/.test(e.target.value))
                      setResponses(r => ({ ...r, retirementAge: e.target.value }));
                  }}
                  className="w-full bg-gray-100 border border-gray-200 focus:border-emerald-500/60 outline-none rounded-xl px-4 py-3 text-2xl font-mono font-bold text-gray-900 placeholder-gray-400 transition-colors pr-20"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-600 uppercase tracking-widest pointer-events-none">yrs old</span>
              </div>
            </div>
          </div>
        )}

        {/* ── COMPOSITE: Monthly Finances (expenses + contribution) ── */}
        {question.type === 'composite_monthly' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase text-gray-600 tracking-widest">Monthly Living Expenses <span className="normal-case font-normal text-gray-400">(for safety bucket sizing)</span></label>
              <input type="text" inputMode="numeric" placeholder="Monthly Expenses $"
                value={responses.monthlyExpenses as string || ''}
                onChange={e => handleResponseCommaNumber(e.target.value, 'monthlyExpenses')}
                className="w-full bg-gray-100 border border-gray-200 focus:border-emerald-500/60 outline-none rounded-xl px-4 py-3 text-2xl font-mono font-bold text-gray-900 placeholder-gray-400 transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase text-gray-600 tracking-widest">Left Over Monthly Amount Available for Investing</label>
              <input type="text" inputMode="numeric" placeholder="Monthly Investing $"
                value={responses.monthlyContribution as string || ''}
                onChange={e => handleResponseCommaNumber(e.target.value, 'monthlyContribution')}
                className="w-full bg-gray-100 border border-gray-200 focus:border-emerald-500/60 outline-none rounded-xl px-4 py-3 text-2xl font-mono font-bold text-gray-900 placeholder-gray-400 transition-colors"
              />
            </div>
          </div>
        )}

        {/* ── MULTI ── */}
        {question.type === 'multi' && (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {question.fields?.map(field => (
              <div key={field}>
                <button onClick={() => setMultiValue(m => ({ ...m, [field]: !m[field] }))}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-all flex items-center justify-between ${multiValue[field] ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700' : 'bg-gray-100 border-gray-200 text-gray-700 hover:border-zinc-400'}`}>
                  <span className="text-sm font-medium">{field}</span>
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${multiValue[field] ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-400'}`}>
                    {multiValue[field] && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  </div>
                </button>

                {/* Sub-fields for Workplace 401k */}
                {field === 'Workplace Retirement Plan (401k / 403b)' && multiValue[field] && (
                  <div className="mt-2 ml-3 p-4 bg-gray-100 rounded-xl border-l-2 border-emerald-500/50 space-y-3 animate-fade-in">
                    <div className="space-y-1.5">
                      <label className="text-xs font-mono uppercase text-gray-600 tracking-widest">Employer Match %</label>
                      <input type="text" inputMode="decimal" placeholder="e.g. 4"
                        value={responses.employerMatch as string || ''}
                        onChange={e => { if (e.target.value === '' || /^\d*\.?\d*$/.test(e.target.value)) setResponses({ ...responses, employerMatch: e.target.value }); }}
                        className="w-full bg-slate-50 border border-gray-200 focus:border-emerald-500/60 outline-none rounded-lg px-3 py-2 text-sm font-mono font-bold text-gray-900 placeholder-gray-400 transition-colors"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-mono uppercase text-gray-600 tracking-widest">Roth 401(k) Available?</label>
                      <div className="flex gap-2">
                        {['Yes','No'].map(opt => (
                          <button key={opt} onClick={() => setResponses({ ...responses, rothOption: opt })}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border ${responses.rothOption === opt ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-slate-50 border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Next button — not for pure select (those auto-advance) */}
      {question.type !== 'select' && (
        <button onClick={handleNext} disabled={!canProceed}
          className="w-full flex items-center justify-center gap-2 py-3.5 px-6 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-100 disabled:text-gray-300 text-white rounded-xl font-semibold text-sm transition-all active:scale-[0.98]">
          Confirm & Continue
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

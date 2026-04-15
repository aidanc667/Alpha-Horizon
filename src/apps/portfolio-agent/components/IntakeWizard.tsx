'use client';

// ─── IntakeWizard ─────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import type { IntakeAnswers } from '../types';
import { US_STATES, ACCOUNT_OPTIONS } from '../constants';

interface IntakeWizardProps {
  onComplete: (answers: IntakeAnswers) => void;
  onBack: () => void;
}

type PartialAnswers = {
  primaryGoal?: IntakeAnswers['primaryGoal'];
  startingCapital?: number;
  monthlyContribution?: number;
  yearsUntilWithdrawal?: number;
  incomeStability?: IntakeAnswers['incomeStability'];
  marketDropReaction?: IntakeAnswers['marketDropReaction'];
  hasEmergencyFund?: boolean;
  hasLargeExpense?: boolean;
  largeExpenseAmount?: number;
  state?: string;
  annualIncome?: number;
  accounts?: string[];
  hasSectorPreferences?: boolean;
  favoredSectors?: string;
  avoidedSectors?: string;
};

const TOTAL_STEPS = 11;

function ProgressBar({ step }: { step: number }) {
  const pct = ((step + 1) / TOTAL_STEPS) * 100;
  return (
    <div className="w-full h-1 bg-white/8 rounded-full mb-8">
      <div
        className="h-1 rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: '#06b6d4' }}
      />
    </div>
  );
}

function StepLabel({ step }: { step: number }) {
  return (
    <p className="text-xs text-slate-500 mb-2 font-mono">
      Question {step + 1} of {TOTAL_STEPS}
    </p>
  );
}

interface OptionCardProps {
  icon: string;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}

function OptionCard({ icon, title, description, selected, onClick }: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`bg-white/4 border rounded-xl p-4 text-left transition-all w-full ${
        selected
          ? 'border-cyan-500/60 bg-cyan-500/10'
          : 'border-white/8 hover:border-cyan-500/40'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <div className="text-white font-semibold text-sm">{title}</div>
          <div className="text-slate-400 text-xs mt-0.5">{description}</div>
        </div>
        {selected && (
          <div className="ml-auto w-4 h-4 rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: '#06b6d4' }} />
        )}
      </div>
    </button>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  placeholder,
  prefix,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
  placeholder?: string;
  prefix?: string;
}) {
  return (
    <div>
      <label className="block text-slate-300 text-sm font-medium mb-3">{label}</label>
      <div className="flex items-center">
        {prefix && <span className="text-2xl text-slate-400 font-mono font-bold mr-2">{prefix}</span>}
        <input
          type="number"
          value={value ?? ''}
          onChange={e => onChange(Number(e.target.value))}
          placeholder={placeholder ?? '0'}
          className="bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-white text-2xl font-mono font-bold w-full outline-none focus:border-cyan-500/60 transition-all"
        />
      </div>
    </div>
  );
}

export default function IntakeWizard({ onComplete, onBack }: IntakeWizardProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<PartialAnswers>({ accounts: [] });
  const [error, setError] = useState<string | null>(null);

  function patch(updates: Partial<PartialAnswers>) {
    setAnswers(prev => ({ ...prev, ...updates }));
    setError(null);
  }

  // Auto-advance after selecting an option (for single-select steps with no follow-up input)
  function patchAndAdvance(updates: Partial<PartialAnswers>, skipAdvance = false) {
    const merged = { ...answers, ...updates };
    setAnswers(merged);
    setError(null);
    if (!skipAdvance) {
      setTimeout(() => {
        if (step === TOTAL_STEPS - 1) {
          const final = merged as IntakeAnswers;
          final.accounts = merged.accounts ?? [];
          onComplete(final);
        } else {
          setStep(s => s + 1);
        }
      }, 220);
    }
  }

  function validate(): boolean {
    switch (step) {
      case 0: if (!answers.primaryGoal) { setError('Please select a goal'); return false; } break;
      case 1: if (answers.startingCapital === undefined || answers.startingCapital < 0) { setError('Please enter your starting capital'); return false; } break;
      case 2: if (answers.monthlyContribution === undefined || answers.monthlyContribution < 0) { setError('Please enter your monthly contribution'); return false; } break;
      case 3: if (!answers.yearsUntilWithdrawal || answers.yearsUntilWithdrawal < 1) { setError('Please enter a valid number of years (at least 1)'); return false; } break;
      case 4: if (!answers.incomeStability) { setError('Please select your income stability level'); return false; } break;
      case 5: if (!answers.marketDropReaction) { setError('Please select your reaction'); return false; } break;
      case 6: if (answers.hasEmergencyFund === undefined) { setError('Please make a selection'); return false; } break;
      case 7: if (answers.hasLargeExpense === undefined) { setError('Please make a selection'); return false; }
               if (answers.hasLargeExpense && (!answers.largeExpenseAmount || answers.largeExpenseAmount <= 0)) { setError('Please enter the expense amount'); return false; } break;
      case 8: if (!answers.state) { setError('Please select your state'); return false; }
               if (!answers.annualIncome || answers.annualIncome <= 0) { setError('Please enter your annual income'); return false; } break;
      case 9: break; // accounts optional
      case 10: if (answers.hasSectorPreferences === undefined) { setError('Please make a selection'); return false; } break;
    }
    return true;
  }

  function handleNext() {
    if (!validate()) return;
    if (step < TOTAL_STEPS - 1) {
      setStep(s => s + 1);
    } else {
      // Final step — submit
      const final = answers as IntakeAnswers;
      final.accounts = answers.accounts ?? [];
      onComplete(final);
    }
  }

  function handleBack() {
    if (step === 0) {
      onBack();
    } else {
      setStep(s => s - 1);
      setError(null);
    }
  }

  const isLastStep = step === TOTAL_STEPS - 1;

  return (
    <div className="max-w-2xl mx-auto">
      <ProgressBar step={step} />

      <div className="bg-slate-900 border border-white/8 rounded-2xl p-6 space-y-5">
        <StepLabel step={step} />

        {/* Q1 — Primary Goal */}
        {step === 0 && (
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-white">What is your primary investment goal?</h2>
            <div className="grid grid-cols-1 gap-3">
              {([
                { value: 'financial_independence', icon: '💰', title: 'Financial Independence', description: 'Cash flow focused — build income streams' },
                { value: 'major_purchase', icon: '🏠', title: 'Major Purchase', description: 'House, business, or education goal' },
                { value: 'max_growth', icon: '🚀', title: 'Maximum Growth', description: 'Long-term wealth accumulation' },
                { value: 'legacy', icon: '🏛️', title: 'Legacy Planning', description: 'Tax-efficient wealth transfer' },
              ] as const).map(opt => (
                <OptionCard
                  key={opt.value}
                  icon={opt.icon}
                  title={opt.title}
                  description={opt.description}
                  selected={answers.primaryGoal === opt.value}
                  onClick={() => patchAndAdvance({ primaryGoal: opt.value })}
                />
              ))}
            </div>
          </div>
        )}

        {/* Q2 — Starting Capital */}
        {step === 1 && (
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-white">How much are you starting with?</h2>
            <p className="text-slate-400 text-sm">Total investable assets available today (cash, existing brokerage, etc.)</p>
            <NumberInput
              label="Total starting capital ($)"
              value={answers.startingCapital}
              onChange={v => patch({ startingCapital: v })}
              placeholder="50000"
              prefix="$"
            />
          </div>
        )}

        {/* Q3 — Monthly Contribution */}
        {step === 2 && (
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-white">How much can you invest monthly?</h2>
            <p className="text-slate-400 text-sm">Regular contributions accelerate compounding — enter 0 if none</p>
            <NumberInput
              label="Monthly contribution ($)"
              value={answers.monthlyContribution}
              onChange={v => patch({ monthlyContribution: v })}
              placeholder="500"
              prefix="$"
            />
          </div>
        )}

        {/* Q4 — Years Until Withdrawal */}
        {step === 3 && (
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-white">What is your Time Horizon?</h2>
            <p className="text-slate-400 text-sm">Your time horizon determines how much risk you can sustain</p>
            <NumberInput
              label="Years until you need the majority of this money"
              value={answers.yearsUntilWithdrawal}
              onChange={v => patch({ yearsUntilWithdrawal: v })}
              placeholder="20"
            />
          </div>
        )}

        {/* Q5 — Income Stability */}
        {step === 4 && (
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-white">How stable is your income?</h2>
            <p className="text-slate-400 text-sm">Income volatility affects how much liquidity buffer you need</p>
            <div className="grid grid-cols-1 gap-3">
              {([
                { value: 1, icon: '🎲', title: 'Highly Variable', description: 'Freelance, commission, gig economy' },
                { value: 2, icon: '📊', title: 'Somewhat Variable', description: 'Self-employed or contract' },
                { value: 3, icon: '🏢', title: 'Moderate', description: 'Private sector, at-will employment' },
                { value: 4, icon: '🏦', title: 'Stable', description: 'Established company, tenured role' },
                { value: 5, icon: '🏛️', title: 'Very Stable', description: 'Government, academic, pension' },
              ] as const).map(opt => (
                <OptionCard
                  key={opt.value}
                  icon={opt.icon}
                  title={opt.title}
                  description={opt.description}
                  selected={answers.incomeStability === opt.value}
                  onClick={() => patchAndAdvance({ incomeStability: opt.value })}
                />
              ))}
            </div>
          </div>
        )}

        {/* Q6 — Market Drop Reaction */}
        {step === 5 && (
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-white">The market drops 30%. What do you do?</h2>
            <p className="text-slate-400 text-sm">Be honest — behavioral fit is as important as return targets</p>
            <div className="grid grid-cols-1 gap-3">
              {([
                { value: 'panic', icon: '😨', title: 'Sell to protect capital', description: 'Safety over staying invested' },
                { value: 'passive', icon: '😐', title: 'Hold and wait', description: 'Trust the long-term process' },
                { value: 'aggressive', icon: '💪', title: 'Buy more / rebalance', description: 'Downturns are opportunities' },
              ] as const).map(opt => (
                <OptionCard
                  key={opt.value}
                  icon={opt.icon}
                  title={opt.title}
                  description={opt.description}
                  selected={answers.marketDropReaction === opt.value}
                  onClick={() => patchAndAdvance({ marketDropReaction: opt.value })}
                />
              ))}
            </div>
          </div>
        )}

        {/* Q7 — Emergency Fund */}
        {step === 6 && (
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-white">Do you have an emergency fund?</h2>
            <p className="text-slate-400 text-sm">3-6 months of expenses in liquid cash, separate from this portfolio</p>
            <div className="grid grid-cols-1 gap-3">
              <OptionCard
                icon="✅"
                title="Yes — I have 3-6 months of expenses in cash"
                description="Agent will prioritize growth allocation"
                selected={answers.hasEmergencyFund === true}
                onClick={() => patchAndAdvance({ hasEmergencyFund: true })}
              />
              <OptionCard
                icon="❌"
                title="No — I don't have a full emergency fund"
                description="Agent will mandate a cash/money market reserve first"
                selected={answers.hasEmergencyFund === false}
                onClick={() => patchAndAdvance({ hasEmergencyFund: false })}
              />
            </div>
          </div>
        )}

        {/* Q8 — Large Planned Expense */}
        {step === 7 && (
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-white">Any large planned expenses in the next 5 years?</h2>
            <p className="text-slate-400 text-sm">Down payment, tuition, business investment, etc.</p>
            <div className="grid grid-cols-1 gap-3">
              <OptionCard
                icon="✓"
                title="No large planned expenses"
                description="Full horizon available for compounding"
                selected={answers.hasLargeExpense === false}
                onClick={() => patchAndAdvance({ hasLargeExpense: false, largeExpenseAmount: undefined })}
              />
              <OptionCard
                icon="📅"
                title="Yes — I have a large expense coming up"
                description="Agent will set aside a liquidity sleeve"
                selected={answers.hasLargeExpense === true}
                onClick={() => patchAndAdvance({ hasLargeExpense: true }, true)}
              />
            </div>
            {answers.hasLargeExpense && (
              <div className="mt-3">
                <NumberInput
                  label="Approximate expense amount ($)"
                  value={answers.largeExpenseAmount}
                  onChange={v => patch({ largeExpenseAmount: v })}
                  placeholder="30000"
                  prefix="$"
                />
              </div>
            )}
          </div>
        )}

        {/* Q9 — State & Income */}
        {step === 8 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white">Tax profile</h2>
            <p className="text-slate-400 text-sm">Used to estimate your marginal tax rate and asset location strategy</p>
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">State of residence</label>
              <select
                value={answers.state ?? ''}
                onChange={e => patch({ state: e.target.value })}
                className="bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-white w-full outline-none focus:border-cyan-500/60 transition-all"
              >
                <option value="">Select state...</option>
                {US_STATES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <NumberInput
              label="Annual gross income ($)"
              value={answers.annualIncome}
              onChange={v => patch({ annualIncome: v })}
              placeholder="120000"
              prefix="$"
            />
          </div>
        )}

        {/* Q10 — Accounts */}
        {step === 9 && (
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-white">Which accounts do you have available?</h2>
            <p className="text-slate-400 text-sm">Select all that apply — determines asset location optimization</p>
            <div className="grid grid-cols-1 gap-2">
              {ACCOUNT_OPTIONS.map(opt => {
                const isSelected = (answers.accounts ?? []).includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      const current = answers.accounts ?? [];
                      patch({
                        accounts: isSelected
                          ? current.filter(a => a !== opt)
                          : [...current, opt],
                      });
                    }}
                    className={`border rounded-xl p-4 text-left transition-all flex items-center gap-3 ${
                      isSelected
                        ? 'border-cyan-500/60 bg-cyan-500/10'
                        : 'bg-white/4 border-white/8 hover:border-cyan-500/40'
                    }`}
                  >
                    <div
                      className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0"
                      style={isSelected ? { borderColor: '#06b6d4', backgroundColor: '#06b6d4' } : { borderColor: 'rgba(255,255,255,0.3)' }}
                    >
                      {isSelected && <span className="text-black text-xs font-bold">✓</span>}
                    </div>
                    <span className="text-white text-sm">{opt}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Q11 — Sector Preferences */}
        {step === 10 && (
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-white">Do you have sector or asset preferences?</h2>
            <p className="text-slate-400 text-sm">ESG concerns, industry tilts, or sectors you want to avoid</p>
            <div className="grid grid-cols-1 gap-3">
              <OptionCard
                icon="⚖️"
                title="No strong preferences — let the agent decide"
                description="Pure quantitative optimization"
                selected={answers.hasSectorPreferences === false}
                onClick={() => patchAndAdvance({ hasSectorPreferences: false, favoredSectors: undefined, avoidedSectors: undefined })}
              />
              <OptionCard
                icon="🎯"
                title="Yes — I have specific preferences"
                description="Specify sectors to favor or avoid"
                selected={answers.hasSectorPreferences === true}
                onClick={() => patchAndAdvance({ hasSectorPreferences: true }, true)}
              />
            </div>
            {answers.hasSectorPreferences && (
              <div className="space-y-3 mt-2">
                <div>
                  <label className="block text-slate-300 text-sm font-medium mb-2">
                    Sectors / assets to favor (e.g. &quot;clean energy, healthcare, dividend stocks&quot;)
                  </label>
                  <textarea
                    value={answers.favoredSectors ?? ''}
                    onChange={e => patch({ favoredSectors: e.target.value })}
                    placeholder="e.g. technology, healthcare, dividend ETFs..."
                    rows={2}
                    className="bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-white w-full outline-none focus:border-cyan-500/60 transition-all resize-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 text-sm font-medium mb-2">
                    Sectors / assets to avoid (e.g. &quot;fossil fuels, tobacco, gambling&quot;)
                  </label>
                  <textarea
                    value={answers.avoidedSectors ?? ''}
                    onChange={e => patch({ avoidedSectors: e.target.value })}
                    placeholder="e.g. fossil fuels, weapons, tobacco..."
                    rows={2}
                    className="bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-white w-full outline-none focus:border-cyan-500/60 transition-all resize-none text-sm"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">{error}</p>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={handleBack}
            className="px-5 py-2.5 bg-white/6 hover:bg-white/10 text-slate-300 rounded-xl transition-all text-sm font-medium border border-white/8"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={handleNext}
            style={{ backgroundColor: '#06b6d4', color: '#000' }}
            className="px-6 py-2.5 font-bold rounded-xl transition-all text-sm hover:opacity-90"
          >
            {isLastStep ? 'Launch Portfolio Agent →' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}

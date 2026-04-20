'use client';

// ─── IntakeWizard ─────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import type { IntakeAnswers } from '../types';
import { INTAKE_QUESTIONS } from '@/lib/intake/questions';
import { validateQuestion, transformAnswersToIntakeAnswers } from '@/lib/intake/validation';

interface IntakeWizardProps {
  onComplete: (answers: IntakeAnswers) => void;
  onBack: () => void;
}

// ─── Shared input primitives ──────────────────────────────────────────────────

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

// ─── Main wizard ──────────────────────────────────────────────────────────────

export default function IntakeWizard({ onComplete, onBack }: IntakeWizardProps) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const currentQuestion = INTAKE_QUESTIONS[currentQuestionIndex];
  const progress = ((currentQuestionIndex + 1) / INTAKE_QUESTIONS.length) * 100;
  const isLastQuestion = currentQuestionIndex === INTAKE_QUESTIONS.length - 1;

  // ── Navigation ───────────────────────────────────────────────────────────────

  const handleNext = () => {
    const validation = validateQuestion(currentQuestion.id, answers[currentQuestion.id]);
    if (!validation.valid) {
      setErrors({ [currentQuestion.id]: validation.error ?? 'Invalid answer' });
      return;
    }
    setErrors({});
    setCurrentQuestionIndex(i => i + 1);
  };

  const handleBack = () => {
    if (currentQuestionIndex === 0) {
      onBack();
    } else {
      setCurrentQuestionIndex(i => i - 1);
      setErrors({});
    }
  };

  // Fix: was a stub — now actually transforms and submits
  const handleSubmit = () => {
    const validation = validateQuestion(currentQuestion.id, answers[currentQuestion.id]);
    if (!validation.valid) {
      setErrors({ [currentQuestion.id]: validation.error ?? 'Invalid answer' });
      return;
    }
    const intakeAnswers = transformAnswersToIntakeAnswers(answers);
    onComplete(intakeAnswers as unknown as IntakeAnswers);
  };

  // ── Question renderer ─────────────────────────────────────────────────────────

  function renderQuestionBody() {
    const qid = currentQuestion.id;
    const currentAnswer = answers[qid];

    switch (currentQuestion.type) {

      // ── single_select ────────────────────────────────────────────────────────
      case 'single_select':
        return (
          <div className="grid grid-cols-1 gap-3">
            {currentQuestion.options!.map(option => {
              const isSelected = currentAnswer === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setAnswers(prev => ({ ...prev, [qid]: option }));
                    setErrors({});
                  }}
                  className={`bg-white/4 border rounded-xl p-4 text-left transition-all w-full ${
                    isSelected ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-white/8 hover:border-cyan-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-white text-sm font-medium">{option}</span>
                    {isSelected && (
                      <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: '#06b6d4' }} />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        );

      // ── multi_select ─────────────────────────────────────────────────────────
      case 'multi_select': {
        const selected: string[] = (currentAnswer as string[]) ?? [];
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2">
              {currentQuestion.options!.map(option => {
                const isSelected = selected.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      const next = isSelected
                        ? selected.filter(s => s !== option)
                        : [...selected, option];
                      setAnswers(prev => ({ ...prev, [qid]: next }));
                      setErrors({});
                    }}
                    className={`border rounded-xl p-4 text-left transition-all flex items-center gap-3 ${
                      isSelected
                        ? 'border-cyan-500/60 bg-cyan-500/10'
                        : 'bg-white/4 border-white/8 hover:border-cyan-500/40'
                    }`}
                  >
                    <div
                      className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0"
                      style={isSelected
                        ? { borderColor: '#06b6d4', backgroundColor: '#06b6d4' }
                        : { borderColor: 'rgba(255,255,255,0.3)' }}
                    >
                      {isSelected && <span className="text-black text-xs font-bold">✓</span>}
                    </div>
                    <span className="text-white text-sm">{option}</span>
                  </button>
                );
              })}
            </div>

            {currentQuestion.followups && selected.flatMap(sel => {
              const followupList = currentQuestion.followups![sel];
              if (!followupList) return [];
              return followupList.map(fq => (
                <div key={fq.id} className="pl-4 border-l-2 border-cyan-500/30 space-y-2">
                  <label className="block text-slate-300 text-sm font-medium">{fq.label}</label>
                  <div className="flex items-center">
                    {fq.type === 'currency' && (
                      <span className="text-2xl text-slate-400 font-mono font-bold mr-2">$</span>
                    )}
                    <input
                      type="number"
                      value={(answers[`${qid}_${fq.id}`] as number | undefined) ?? ''}
                      onChange={e =>
                        setAnswers(prev => ({ ...prev, [`${qid}_${fq.id}`]: Number(e.target.value) }))
                      }
                      className="bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-white text-2xl font-mono font-bold w-full outline-none focus:border-cyan-500/60 transition-all"
                    />
                  </div>
                </div>
              ));
            })}
          </div>
        );
      }

      // ── conditional (Q2): sub-questions depend on Q1 answer ─────────────────
      case 'conditional': {
        const trigger = answers['q1_goal'] as string | undefined;
        const subQuestions = trigger
          ? (currentQuestion.conditionalContent ?? {})[trigger]
          : undefined;
        const partAnswers = ((currentAnswer ?? {}) as Record<string, unknown>);

        if (!subQuestions) {
          return (
            <p className="text-slate-400 text-sm">Please go back and select your primary goal first.</p>
          );
        }

        const updateSub = (subId: string, val: unknown) =>
          setAnswers(prev => ({ ...prev, [qid]: { ...(prev[qid] as Record<string, unknown> ?? {}), [subId]: val } }));

        return (
          <div className="space-y-4">
            {subQuestions.map(sq => (
              <div key={sq.id}>
                <label className="block text-slate-300 text-sm font-medium mb-2">{sq.label}</label>
                <div className="flex items-center">
                  {sq.type === 'currency' && (
                    <span className="text-2xl text-slate-400 font-mono font-bold mr-2">$</span>
                  )}
                  <input
                    type="number"
                    value={(partAnswers[sq.id] as number | undefined) ?? ''}
                    onChange={e => updateSub(sq.id, Number(e.target.value))}
                    className="bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-white text-2xl font-mono font-bold w-full outline-none focus:border-cyan-500/60 transition-all"
                  />
                </div>
              </div>
            ))}
          </div>
        );
      }

      // ── multi_part ───────────────────────────────────────────────────────────
      case 'multi_part': {
        const partAnswers = ((currentAnswer ?? {}) as Record<string, unknown>);
        const updatePart = (partId: string, val: unknown) =>
          setAnswers(prev => ({ ...prev, [qid]: { ...(prev[qid] as Record<string, unknown> ?? {}), [partId]: val } }));

        return (
          <div className="space-y-4">
            {(currentQuestion.parts ?? []).map(part => {
              if (part.showIf) {
                const [siblingId, expectedVal] = Object.entries(part.showIf)[0];
                if ((partAnswers[siblingId] ?? false) !== expectedVal) return null;
              }
              return (
                <div key={part.id}>
                  <label className="block text-slate-300 text-sm font-medium mb-2">{part.label}</label>
                  {(part.type === 'currency' || part.type === 'number') && (
                    <div className="flex items-center">
                      {part.type === 'currency' && (
                        <span className="text-2xl text-slate-400 font-mono font-bold mr-2">$</span>
                      )}
                      <input
                        type="number"
                        value={(partAnswers[part.id] as number | undefined) ?? ''}
                        onChange={e => updatePart(part.id, Number(e.target.value))}
                        className="bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-white text-2xl font-mono font-bold w-full outline-none focus:border-cyan-500/60 transition-all"
                      />
                    </div>
                  )}
                  {part.type === 'boolean' && (
                    <div className="flex gap-3">
                      {(['Yes', 'No'] as const).map(label => {
                        const boolVal = label === 'Yes';
                        const isActive = partAnswers[part.id] === boolVal;
                        return (
                          <button key={label} type="button" onClick={() => updatePart(part.id, boolVal)}
                            className={`flex-1 border rounded-xl p-3 text-center transition-all text-sm font-medium ${
                              isActive
                                ? 'border-cyan-500/60 bg-cyan-500/10 text-white'
                                : 'bg-white/4 border-white/8 text-slate-300 hover:border-cyan-500/40'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {part.type === 'select' && (
                    <select
                      value={(partAnswers[part.id] as string | undefined) ?? ''}
                      onChange={e => updatePart(part.id, e.target.value)}
                      className="bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-white w-full outline-none focus:border-cyan-500/60 transition-all"
                    >
                      <option value="">Select...</option>
                      {(part.options ?? []).map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        );
      }

      // ── optional_multi_part (Q12) ─────────────────────────────────────────────
      case 'optional_multi_part': {
        const partAnswers = ((currentAnswer ?? {}) as Record<string, unknown>);
        const updatePart = (partId: string, val: unknown) =>
          setAnswers(prev => ({ ...prev, [qid]: { ...(prev[qid] as Record<string, unknown> ?? {}), [partId]: val } }));

        return (
          <div className="space-y-3">
            {(currentQuestion.parts ?? []).map(part => {
              if (part.showIf) {
                const [siblingId, expectedVal] = Object.entries(part.showIf)[0];
                if (((partAnswers[siblingId] ?? false) as boolean) !== expectedVal) return null;
              }
              return (
                <div key={part.id}>
                  {part.type === 'boolean' && (
                    <button
                      type="button"
                      onClick={() => updatePart(part.id, !partAnswers[part.id])}
                      className={`border rounded-xl p-4 text-left transition-all w-full flex items-center gap-3 ${
                        partAnswers[part.id]
                          ? 'border-cyan-500/60 bg-cyan-500/10'
                          : 'bg-white/4 border-white/8 hover:border-cyan-500/40'
                      }`}
                    >
                      <div
                        className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0"
                        style={partAnswers[part.id]
                          ? { borderColor: '#06b6d4', backgroundColor: '#06b6d4' }
                          : { borderColor: 'rgba(255,255,255,0.3)' }}
                      >
                        {!!partAnswers[part.id] && <span className="text-black text-xs font-bold">✓</span>}
                      </div>
                      <span className="text-white text-sm">{part.label}</span>
                    </button>
                  )}
                  {part.type === 'text' && (
                    <div>
                      <label className="block text-slate-300 text-sm font-medium mb-2">{part.label}</label>
                      <textarea
                        value={(partAnswers[part.id] as string | undefined) ?? ''}
                        onChange={e => updatePart(part.id, e.target.value)}
                        rows={2}
                        className="bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-white w-full outline-none focus:border-cyan-500/60 transition-all resize-none text-sm"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      }

      default:
        return null;
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  // Q2 tooltip has context-sensitive text depending on Q1's answer
  let helpText = currentQuestion.helpText;
  if (currentQuestion.type === 'conditional') {
    const goal = answers['q1_goal'] as string | undefined;
    if (goal === 'Retirement (Financial Independence)') {
      helpText = "We'll calculate how much you need based on your lifestyle";
    } else if (goal === 'Major Purchase (home, education, etc.)') {
      helpText = 'This helps us ensure funds are available when you need them';
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress bar */}
      <div className="w-full h-1 bg-white/8 rounded-full mb-8">
        <div
          className="h-1 rounded-full transition-all duration-500"
          style={{ width: `${progress}%`, backgroundColor: '#06b6d4' }}
        />
      </div>

      <div className="bg-slate-900 border border-white/8 rounded-2xl p-6 space-y-5">
        {/* Section + counter */}
        <div>
          <p className="text-xs text-slate-500 font-mono uppercase tracking-wider mb-0.5">
            {currentQuestion.section}
          </p>
          <p className="text-xs text-slate-500 font-mono">
            Question {currentQuestionIndex + 1} of {INTAKE_QUESTIONS.length}
          </p>
        </div>

        {/* Question heading + helpText as subtitle (not a tooltip box) */}
        <div>
          <h2 className="text-xl font-bold text-white">{currentQuestion.question}</h2>
          {helpText && (
            <p className="text-slate-400 text-sm mt-1">{helpText}</p>
          )}
        </div>

        {/* Dynamic body */}
        {renderQuestionBody()}

        {/* Error */}
        {errors[currentQuestion.id] && (
          <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
            {errors[currentQuestion.id]}
          </p>
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
            onClick={isLastQuestion ? handleSubmit : handleNext}
            style={{ backgroundColor: '#06b6d4', color: '#000' }}
            className="px-6 py-2.5 font-bold rounded-xl transition-all text-sm hover:opacity-90"
          >
            {isLastQuestion ? 'Launch Portfolio Agent →' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}

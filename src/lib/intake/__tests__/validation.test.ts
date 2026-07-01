import { describe, it, expect } from 'vitest';
import { validateQuestion } from '../validation';

// q5_monthlyContribution is a multi_part question; the amount part allows 0.
describe('validateQuestion — monthly contribution', () => {
  it('accepts 0 for monthly contribution', () => {
    const result = validateQuestion('q5_monthlyContribution', { amount: 0, contributionConfidence: 'high' });
    expect(result.valid).toBe(true);
  });

  it('accepts a positive monthly contribution', () => {
    const result = validateQuestion('q5_monthlyContribution', { amount: 500, contributionConfidence: 'high' });
    expect(result.valid).toBe(true);
  });
});

// Age is validated inside the q7_taxSituation multi_part question.
describe('validateQuestion — age (via q7_taxSituation)', () => {
  const baseQ7 = {
    filingStatus: 'Single',
    annualIncome: 80000,
    state: 'CA',
  };

  it('rejects age below 18', () => {
    const result = validateQuestion('q7_taxSituation', { ...baseQ7, age: 17 });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/18/);
  });

  it('rejects age above 120', () => {
    const result = validateQuestion('q7_taxSituation', { ...baseQ7, age: 121 });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/120/);
  });

  it('accepts a normal age of 35', () => {
    const result = validateQuestion('q7_taxSituation', { ...baseQ7, age: 35 });
    expect(result.valid).toBe(true);
  });

  it('accepts boundary age of 18', () => {
    const result = validateQuestion('q7_taxSituation', { ...baseQ7, age: 18 });
    expect(result.valid).toBe(true);
  });

  it('accepts boundary age of 120', () => {
    const result = validateQuestion('q7_taxSituation', { ...baseQ7, age: 120 });
    expect(result.valid).toBe(true);
  });
});

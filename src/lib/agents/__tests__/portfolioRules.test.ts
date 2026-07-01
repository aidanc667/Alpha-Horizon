import { describe, it, expect } from 'vitest';
import { deriveTargetAllocation, selectETFsForAllocation } from '../portfolioRules';

describe('deriveTargetAllocation', () => {
  it('high risk long-term investor gets equityTarget >= 0.80', () => {
    const result = deriveTargetAllocation(9, 25, 'neutral', 1.0, true);
    expect(result.equityTarget).toBeGreaterThanOrEqual(0.80);
  });

  it('allocation components sum to 1.0', () => {
    const cases: Array<[number, number, string, number, boolean]> = [
      [5, 15, 'neutral', 1.0, true],
      [3, 7,  'risk_off', 0.8, false],
      [8, 20, 'neutral', 1.1, true],
      [1, 3,  'neutral', 0.5, false],
    ];
    for (const [risk, years, regime, funded, emergency] of cases) {
      const { equityTarget, bondTarget, cashTarget } = deriveTargetAllocation(
        risk, years, regime, funded, emergency,
      );
      expect(equityTarget + bondTarget + cashTarget).toBeCloseTo(1.0, 10);
    }
  });

  it('low risk short-term investor gets lower equity than high risk long-term', () => {
    const conservative = deriveTargetAllocation(2, 3, 'neutral', 1.0, true);
    const aggressive   = deriveTargetAllocation(9, 25, 'neutral', 1.0, true);
    expect(conservative.equityTarget).toBeLessThan(aggressive.equityTarget);
  });

  it('risk_off regime reduces equityTarget', () => {
    const neutral  = deriveTargetAllocation(7, 15, 'neutral',  1.0, true);
    const riskOff  = deriveTargetAllocation(7, 15, 'risk_off', 1.0, true);
    expect(riskOff.equityTarget).toBeLessThan(neutral.equityTarget);
  });

  it('no emergency fund adds 10% cash', () => {
    const { cashTarget } = deriveTargetAllocation(5, 15, 'neutral', 1.0, false);
    expect(cashTarget).toBe(0.10);
  });
});

describe('selectETFsForAllocation', () => {
  it('weights sum to 1.0 ± 0.01', () => {
    const slices = selectETFsForAllocation(0.8, 0.2, 0, 7, 0.22, ['taxable', 'roth']);
    const total = slices.reduce((sum, s) => sum + s.weight, 0);
    expect(Math.abs(total - 1.0)).toBeLessThan(0.01);
  });

  it('does not include both VTI and VT', () => {
    const slices = selectETFsForAllocation(0.8, 0.2, 0, 7, 0.22, ['taxable']);
    const tickers = slices.map(s => s.ticker);
    expect(tickers.includes('VTI') && tickers.includes('VT')).toBe(false);
  });

  it('returns at least 3 holdings', () => {
    const slices = selectETFsForAllocation(0.6, 0.4, 0, 5, 0.22, ['taxable', 'traditional']);
    expect(slices.length).toBeGreaterThanOrEqual(3);
  });

  it('cash-only portfolio returns SGOV', () => {
    const slices = selectETFsForAllocation(0, 0, 1.0, 5, 0.22, ['taxable']);
    expect(slices.length).toBe(1);
    expect(slices[0].ticker).toBe('SGOV');
    expect(slices[0].weight).toBeCloseTo(1.0, 10);
  });
});

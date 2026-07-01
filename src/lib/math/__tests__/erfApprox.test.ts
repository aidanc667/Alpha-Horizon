import { describe, it, expect } from 'vitest';
import { erfApprox } from '../erfApprox';

describe('erfApprox', () => {
  const cases: [number, number][] = [
    [-3, -0.9999779095],
    [-1, -0.8427007929],
    [0,   0],
    [0.5,  0.5204998778],
    [1,    0.8427007929],
    [2,    0.9953222650],
    [3,    0.9999779095],
  ];

  it.each(cases)('erfApprox(%f) ≈ %f within 1e-6', (x, expected) => {
    expect(Math.abs(erfApprox(x) - expected)).toBeLessThan(1e-6);
  });

  it('negative inputs match negated positive values from reference table', () => {
    expect(Math.abs(erfApprox(-1) - (-0.8427007929))).toBeLessThan(1e-6);
    expect(Math.abs(erfApprox(-0.5) - (-0.5204998778))).toBeLessThan(1e-6);
    expect(Math.abs(erfApprox(-2) - (-0.9953222650))).toBeLessThan(1e-6);
    expect(Math.abs(erfApprox(-3) - (-0.9999779095))).toBeLessThan(1e-6);
  });

  it('erfApprox(0) ≈ 0', () => {
    expect(erfApprox(0)).toBeCloseTo(0, 5);
  });
});

import { describe, it, expect } from 'vitest';
import { erfApprox } from '../erfApprox';

describe('erfApprox', () => {
  const cases: [number, number][] = [
    [-3, -0.9999779],
    [-1, -0.8427008],
    [0,   0],
    [0.5,  0.5204999],
    [1,    0.8427008],
    [2,    0.9953223],
    [3,    0.9999779],
  ];

  it.each(cases)('erfApprox(%f) ≈ %f within 1e-4', (x, expected) => {
    expect(Math.abs(erfApprox(x) - expected)).toBeLessThan(1e-4);
  });

  it('is odd: erfApprox(-x) === -erfApprox(x)', () => {
    for (const x of [0.1, 0.5, 1, 2, 3]) {
      expect(erfApprox(-x)).toBeCloseTo(-erfApprox(x), 10);
    }
  });

  it('erfApprox(0) ≈ 0', () => {
    expect(erfApprox(0)).toBeCloseTo(0, 5);
  });
});

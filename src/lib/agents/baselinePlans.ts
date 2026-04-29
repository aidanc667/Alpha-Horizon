/**
 * baselinePlans.ts
 *
 * Ten institutionally-designed seed portfolios covering 5 risk tiers × 2 horizon
 * buckets. Each seed is passed to the Sharpe optimizer as warm-start weights so
 * the optimizer begins from a proven high-scoring region rather than equal weights.
 *
 * Design principles:
 *   - Boglehead Three-Fund core (VTI + VXUS for moderate+, VT for conservative)
 *   - BND for long horizons (crisis-rally asset, 7yr duration amortizes over time)
 *   - SGOV for short-horizon conservative (capital preservation, near-zero duration)
 *   - SCHP (TIPS) for real return protection on long horizons
 *   - AVUV / AVDV for factor tilts on moderate+ profiles (Fama-French validated)
 *   - SCHD (quality/profitability factor) for lower-beta equity on conservative-moderate
 *   - All weights multiples of 5%, minimum 10%, 3–6 assets, sum = 100%
 *   - Short-horizon equity ≤ 65% (avoids scoreAlignment −10 deduction)
 */

// ─── Individual seed maps ─────────────────────────────────────────────────────

/** Plan 1 — Conservative / Short (<10yr) */
const CONSERVATIVE_SHORT: Record<string, number> = {
  SGOV: 0.40,
  SCHP: 0.25,
  VT:   0.25,
  BND:  0.10,
};

/** Plan 2 — Conservative / Long (≥10yr) */
const CONSERVATIVE_LONG: Record<string, number> = {
  VT:   0.40,
  BND:  0.35,
  SCHP: 0.25,
};

/** Plan 3 — Mod-Conservative / Short (<10yr) */
const MOD_CONSERVATIVE_SHORT: Record<string, number> = {
  VT:   0.30,
  SCHD: 0.20,
  SGOV: 0.25,
  SCHP: 0.15,
  BND:  0.10,
};

/** Plan 4 — Mod-Conservative / Long (≥10yr) */
const MOD_CONSERVATIVE_LONG: Record<string, number> = {
  VT:   0.30,
  SCHD: 0.20,
  BND:  0.25,
  SCHP: 0.15,
  AVUV: 0.10,
};

/** Plan 5 — Moderate / Short (<10yr) */
const MODERATE_SHORT: Record<string, number> = {
  VTI:  0.25,
  VXUS: 0.15,
  SCHD: 0.15,
  BND:  0.30,
  SCHP: 0.15,
};

/** Plan 6 — Moderate / Long (≥10yr) */
const MODERATE_LONG: Record<string, number> = {
  VTI:  0.25,
  VXUS: 0.20,
  AVUV: 0.15,
  SCHD: 0.10,
  BND:  0.20,
  SCHP: 0.10,
};

/** Plan 7 — Mod-Aggressive / Short (<10yr) */
const MOD_AGGRESSIVE_SHORT: Record<string, number> = {
  VTI:  0.30,
  VXUS: 0.20,
  AVUV: 0.15,
  BND:  0.25,
  SCHP: 0.10,
};

/** Plan 8 — Mod-Aggressive / Long (≥10yr) */
const MOD_AGGRESSIVE_LONG: Record<string, number> = {
  VTI:  0.30,
  VXUS: 0.20,
  AVUV: 0.15,
  AVDV: 0.10,
  SCHP: 0.10,
  BND:  0.15,
};

/** Plan 9 — Aggressive / Short (<10yr) */
const AGGRESSIVE_SHORT: Record<string, number> = {
  VTI:  0.25,
  VXUS: 0.15,
  AVUV: 0.15,
  AVDV: 0.10,
  BND:  0.25,
  SGOV: 0.10,
};

/** Plan 10 — Aggressive / Long (≥10yr) */
const AGGRESSIVE_LONG: Record<string, number> = {
  VTI:  0.25,
  VXUS: 0.20,
  AVUV: 0.25,
  AVDV: 0.10,
  SCHD: 0.10,
  BND:  0.10,
};

// ─── Selector ─────────────────────────────────────────────────────────────────

/**
 * Returns the institutional baseline seed for a given risk score and horizon.
 *
 * The seed is passed to optimizeSharpeWeights as `seedWeights` so the optimizer
 * begins gradient ascent from a proven institutional starting region.
 */
export function getBaselineSeed(
  riskScore: number,
  yearsToGoal: number,
): Record<string, number> {
  const isShort = yearsToGoal < 10;

  if (riskScore <= 3) {
    return isShort ? CONSERVATIVE_SHORT : CONSERVATIVE_LONG;
  }
  if (riskScore <= 5) {
    return isShort ? MOD_CONSERVATIVE_SHORT : MOD_CONSERVATIVE_LONG;
  }
  if (riskScore <= 6) {
    return isShort ? MODERATE_SHORT : MODERATE_LONG;
  }
  if (riskScore <= 8) {
    return isShort ? MOD_AGGRESSIVE_SHORT : MOD_AGGRESSIVE_LONG;
  }
  return isShort ? AGGRESSIVE_SHORT : AGGRESSIVE_LONG;
}

/**
 * Returns up to 3 candidate seeds for multi-hypothesis exploration:
 * the primary seed for this profile plus adjacent risk-tier seeds.
 *
 * Used by the critic loop to explore genuinely different regions of the
 * solution space rather than repeatedly squeezing the same local optimum.
 * Deduplicates seeds that map to the same allocation (e.g. at the risk extremes).
 */
export function getCandidateSeeds(
  riskScore: number,
  yearsToGoal: number,
): Array<{ label: string; seed: Record<string, number> }> {
  const primary      = getBaselineSeed(riskScore, yearsToGoal);
  const conservative = getBaselineSeed(Math.max(1, riskScore - 2), yearsToGoal);
  const aggressive   = getBaselineSeed(Math.min(10, riskScore + 2), yearsToGoal);

  const seen = new Set<string>();
  const candidates: Array<{ label: string; seed: Record<string, number> }> = [];

  const add = (label: string, seed: Record<string, number>) => {
    const key = JSON.stringify(Object.entries(seed).sort());
    if (!seen.has(key)) { seen.add(key); candidates.push({ label, seed }); }
  };

  add('primary', primary);
  add('conservative-adjacent', conservative);
  add('aggressive-adjacent', aggressive);

  return candidates;
}

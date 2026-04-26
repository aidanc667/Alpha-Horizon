// ─── Portfolio Policy Engine ──────────────────────────────────────────────────
// Pure deterministic logic: derives the bond target, safety sleeve, account
// placement directives, and filtered ETF guide for a given investor + macro context.
// Extracted from runPortfolioConstructionAgent() — zero behavior changes.

import { buildFilteredETFGuide } from '@/lib/assets';
import type { IntakeAnswers, InvestorProfile, MacroContext } from '@/apps/portfolio-agent/types';
import { BASELINES } from '@/apps/portfolio-agent/constants';
import type { BaselineSlice } from '@/apps/portfolio-agent/constants';

// ─── Account Flags ────────────────────────────────────────────────────────────
// Computed once per request from answers.accounts and threaded into every agent
// function that needs it — eliminates 4x repeated regex over the same array.
export interface AccountFlags {
  hasTaxable: boolean; // standard brokerage / taxable account
  hasRoth:    boolean; // Roth IRA
  hasTrad:    boolean; // 401k / 403b / Traditional IRA
  hasHSA:     boolean; // Health Savings Account
}

export function deriveAccountFlags(accounts: string[]): AccountFlags {
  return {
    hasTaxable: accounts.some(a => /taxable|brokerage/i.test(a)),
    hasRoth:    accounts.some(a => /roth/i.test(a)),
    hasTrad:    accounts.some(a => /401|403|traditional|ira/i.test(a)),
    hasHSA:     accounts.some(a => /hsa/i.test(a)),
  };
}

// ─── Portfolio Policy ─────────────────────────────────────────────────────────

export interface PortfolioPolicy {
  baseline:     BaselineSlice[];
  bondPct:      number;          // integer 0–60, e.g. 40 means 40%
  bondVehicle:  string | null;   // 'VTEB' | 'CMF' | 'BND' | null (null when bondPct === 0)
  safetyPct:    number;          // integer 0–30
  needsSafety:  boolean;         // true if emergency fund missing or large near-term expense
  adjustments:  string[];        // constraint directives for the LLM prompt (ordered, verbatim)
  filteredGuide: string;         // pre-filtered ETF guide string (ready for prompt injection)
}

const FACTOR_TICKERS = new Set(['AVUV', 'AVDV', 'VWO']);

export function derivePortfolioPolicy(
  answers: IntakeAnswers,
  profile: InvestorProfile,
  macro: MacroContext,
  flags: AccountFlags,
): PortfolioPolicy {
  // very_aggressive falls back to aggressive (merged — they were near-identical)
  const rawBaseline = BASELINES[profile.derivedRiskTolerance] ?? BASELINES.aggressive;

  // ── Beginner complexity cap ────────────────────────────────────────────────
  // Beginner investors get a simplified portfolio: max 4 ETFs, no factor tilts.
  // Strip AVUV/AVDV/VWO from the baseline and renormalize remaining weights.
  const isBeginnerExperience = answers.investmentExperience === 'beginner';
  let baseline = rawBaseline;
  if (isBeginnerExperience) {
    const simplified = rawBaseline.filter(s => !FACTOR_TICKERS.has(s.ticker));
    if (simplified.length > 0) {
      const totalWeight = simplified.reduce((sum, s) => sum + s.weight, 0);
      baseline = simplified.map(s => ({ ...s, weight: s.weight / totalWeight }));
    } else {
      // Degenerate case: entire baseline was factor tilts — fall back to VTI/VEA
      baseline = [
        { ticker: 'VTI', name: 'Vanguard Total Stock Market', weight: 0.60, assetClass: 'US Equity',      bucket: 'growth' as const, expectedAnnualReturn: 0.055, accountPlacement: 'taxable' },
        { ticker: 'VEA', name: 'Vanguard Developed Markets',  weight: 0.40, assetClass: 'Intl Developed', bucket: 'growth' as const, expectedAnnualReturn: 0.078, accountPlacement: 'taxable' },
      ];
    }
  }

  // ── Step 1: Compute target bond allocation ────────────────────────────────────
  // All bond/horizon/macro directives are unified into a single numeric target.
  // This eliminates double-counting and gives the LLM a precise allocation to hit.
  //
  // Base: conservative 40%, moderate 15%, aggressive 0%
  // Adjustments: horizon (shorter = more bonds), macro (risk_off/attractive = more bonds),
  //              major-purchase goal (needs capital preservation)
  let targetBondPct =
    profile.derivedRiskTolerance === 'conservative' ? 0.40 :
    profile.derivedRiskTolerance === 'moderate'     ? 0.15 :
    0.00; // aggressive / very_aggressive: equity-only by default

  if      (answers.yearsUntilWithdrawal < 5)  targetBondPct += 0.10;
  else if (answers.yearsUntilWithdrawal < 10) targetBondPct += 0.05;
  else if (answers.yearsUntilWithdrawal > 20) targetBondPct  = Math.max(0, targetBondPct - 0.05);
  if (macro.bondOpportunity === 'attractive') targetBondPct += 0.05;
  if (macro.regime === 'risk_off')            targetBondPct += 0.05;
  if (answers.primaryGoal === 'major_purchase') targetBondPct = Math.max(targetBondPct, 0.25);
  targetBondPct = Math.min(0.60, targetBondPct);
  const bondPct = Math.round(targetBondPct * 100); // e.g. 40

  // ── Step 2: Account type flags ─────────────────────────────────────────────
  const { hasTaxable, hasRoth: hasTaxFree, hasTrad: hasTaxDeferred } = flags;
  const rate         = profile.effectiveMarginalRate;
  const isCalifornia = answers.state === 'CA';

  // ── Step 3: Build directives (equity + bond sleeve + safety sleeve) ─────────
  const adjustments: string[] = [];

  // Equity-side macro signals
  if (macro.equityValuation === 'expensive') adjustments.push('equity expensive: trim US large cap 5%, tilt more toward international (better valuations)');
  if (answers.yearsUntilWithdrawal > 15 && !isBeginnerExperience) adjustments.push('very long horizon: maximize factor tilts (AVUV/AVDV) — short-term volatility is irrelevant');

  // ── Bond sleeve (exactly ONE directive with explicit % target) ────────────
  // Vehicle chosen by tax situation; size set by targetBondPct above.
  // CRITICAL: never hold more than one bond vehicle simultaneously.
  let bondVehicle: string | null = null;
  if (bondPct > 0) {
    if (hasTaxable && rate >= 0.22) {
      if (isCalifornia) {
        bondVehicle = 'CMF';
        const cmfRate = Math.min(rate + 0.093, 0.65);
        adjustments.push(`BOND SLEEVE: Allocate exactly ${bondPct}% to CMF (CA double-exempt muni, TEY ~${(0.030/(1-cmfRate)*100).toFixed(1)}%) in taxable. CMF IS the entire fixed-income allocation — do NOT also add BND, VTEB, or SGOV for bonds.`);
      } else {
        bondVehicle = 'VTEB';
        const vtebTEY = (0.032 / (1 - rate) * 100).toFixed(1);
        adjustments.push(`BOND SLEEVE: Allocate exactly ${bondPct}% to VTEB (national muni, TEY ${vtebTEY}%) in taxable. VTEB IS the entire fixed-income allocation — do NOT also add BND.`);
      }
    } else if (hasTaxDeferred) {
      bondVehicle = 'BND';
      adjustments.push(`BOND SLEEVE: Allocate exactly ${bondPct}% to BND in tax-deferred. Do NOT add any bond ETF to taxable (ordinary income drag in this bracket).`);
    } else {
      // Low-bracket taxable-only: BND acceptable, munis provide no advantage
      bondVehicle = 'BND';
      adjustments.push(`BOND SLEEVE: Allocate exactly ${bondPct}% to BND in taxable. Marginal rate too low for munis to add after-tax value.`);
    }
  }

  // ── Safety/cash sleeve (SGOV — only when structurally required) ─────────────
  // SGOV is emergency/liquidity capital, NOT part of the bond sleeve.
  // If investor has emergency fund and no large expense: zero SGOV.
  const needsSafety = !answers.hasEmergencyFund ||
    (answers.hasLargeExpense && answers.largeExpenseAmount != null && answers.largeExpenseAmount > 0);

  let safetyPct = 0;
  if (!answers.hasEmergencyFund) {
    safetyPct = 10;
    adjustments.push('SAFETY SLEEVE: Allocate exactly 10% to SGOV — emergency fund not established. This is separate from the bond sleeve.');
  } else if (answers.hasLargeExpense && answers.largeExpenseAmount != null && answers.largeExpenseAmount > 0) {
    safetyPct = Math.min(30, Math.round((answers.largeExpenseAmount / Math.max(answers.startingCapital, 1)) * 100));
    adjustments.push(`SAFETY SLEEVE: Allocate exactly ${safetyPct}% to SGOV to cover $${answers.largeExpenseAmount.toLocaleString()} planned expense — liquid, do NOT invest in equities.`);
  }
  if (!needsSafety) {
    adjustments.push('NO safety sleeve: investor has an established emergency fund and no near-term large expense. Do NOT include SGOV anywhere in this portfolio.');
  }

  // ── Beginner directives ───────────────────────────────────────────────────
  if (isBeginnerExperience) {
    adjustments.push('EXPERIENCE CAP: Investor is a first-time investor — keep the portfolio simple. Max 4 ETFs total. No factor tilts: do NOT include AVUV, AVDV, or VWO.');
    adjustments.push('SIMPLICITY RULE: Prefer VTI + VEA (+ bond sleeve if applicable + SGOV if applicable) as the core. Only add a 4th ETF if it provides clear, obvious value. No exotic or niche ETFs.');
  }

  // ── Filtered ETF guide ────────────────────────────────────────────────────
  // Build guide from only the ETFs relevant to THIS request + their overlap partners.
  // Reduces prompt size ~40% vs the full 28-ETF guide, cutting Gemini latency 3–8s.
  const relevantTickers = new Set([
    ...baseline.map(s => s.ticker),                                              // equity baseline (3–5)
    ...(bondPct > 0 ? [hasTaxable && rate >= 0.22                               // bond sleeve
        ? (isCalifornia ? 'CMF' : 'VTEB') : 'BND'] : []),
    ...(needsSafety ? ['SGOV'] : []),                                            // safety sleeve
    ...(!isBeginnerExperience ? ['AVUV', 'AVDV', 'VWO'] : ['VEA']),             // factor/intl alternatives (excluded for beginners)
    ...(profile.derivedRiskTolerance !== 'aggressive' ? ['SPLV', 'SCHD'] : []), // defensive options
    'VT',                                                                        // benchmark reference
    ...(answers.hasSectorPreferences && answers.favoredSectors
        ? (() => {
            const fav = answers.favoredSectors!.toLowerCase();
            const extra: string[] = [];
            if (fav.includes('tech') || fav.includes('growth')) extra.push('QQQM', 'MTUM');
            if (fav.includes('real estate')) extra.push('VNQ');
            if (fav.includes('util')) extra.push('VPU');
            if (fav.includes('gold') || fav.includes('commodit')) extra.push('IAU');
            return extra;
          })()
        : []),
  ]);
  const filteredGuide = buildFilteredETFGuide(relevantTickers);

  // ── Account placement ──────────────────────────────────────────────────────
  if (hasTaxFree && !isBeginnerExperience) adjustments.push('Roth: place AVUV, AVDV, VWO here — highest growth benefits most from tax-free compounding.');
  if (hasTaxDeferred && bondPct > 0) adjustments.push('Traditional/401k: bond sleeve goes here per BOND SLEEVE directive above.');

  // ── Sector preferences ─────────────────────────────────────────────────────
  if (answers.hasSectorPreferences && answers.avoidedSectors) adjustments.push(`avoid sectors: ${answers.avoidedSectors}`);
  if (answers.hasSectorPreferences && answers.favoredSectors)  adjustments.push(`favor sectors: ${answers.favoredSectors}`);

  return { baseline, bondPct, bondVehicle, safetyPct, needsSafety, adjustments, filteredGuide };
}

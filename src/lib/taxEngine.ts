// ─── Marginal Tax Bracket Engine ─────────────────────────────────────────────
// 2026 official brackets. Pure computation — no API calls, no side effects.

export type FilingStatus = 'single' | 'mfj';

export interface BracketTier {
  rate: number;          // e.g. 0.22
  from: number;
  to: number;            // Infinity for top bracket
  incomeInBracket: number;
  taxInBracket: number;
  isMarginal: boolean;
}

export interface TaxBreakdown {
  taxableIncome: number;
  federal: {
    tiers: BracketTier[];
    totalTax: number;
    marginalRate: number;    // e.g. 0.22
    effectiveRate: number;   // e.g. 0.158
    rothHeadroom: number;    // $ to top of current bracket
    nextBracketRate: number; // rate of the bracket above
  };
  california: {
    tiers: BracketTier[];
    totalTax: number;
    marginalRate: number;
    effectiveRate: number;
  };
  combined: {
    totalTax: number;
    effectiveRate: number;
  };
  qdRate: number;
}

const FEDERAL_BRACKETS: Record<FilingStatus, { rate: number; from: number; to: number }[]> = {
  single: [
    { rate: 0.10, from: 0,       to: 11925 },
    { rate: 0.12, from: 11925,   to: 48475 },
    { rate: 0.22, from: 48475,   to: 103350 },
    { rate: 0.24, from: 103350,  to: 197300 },
    { rate: 0.32, from: 197300,  to: 250525 },
    { rate: 0.35, from: 250525,  to: 626350 },
    { rate: 0.37, from: 626350,  to: Infinity },
  ],
  mfj: [
    { rate: 0.10, from: 0,       to: 23850 },
    { rate: 0.12, from: 23850,   to: 96950 },
    { rate: 0.22, from: 96950,   to: 206700 },
    { rate: 0.24, from: 206700,  to: 394600 },
    { rate: 0.32, from: 394600,  to: 501050 },
    { rate: 0.35, from: 501050,  to: 751600 },
    { rate: 0.37, from: 751600,  to: Infinity },
  ],
};

const CA_BRACKETS: Record<FilingStatus, { rate: number; from: number; to: number }[]> = {
  single: [
    { rate: 0.01,  from: 0,       to: 10756 },
    { rate: 0.02,  from: 10756,   to: 25499 },
    { rate: 0.04,  from: 25499,   to: 40245 },
    { rate: 0.06,  from: 40245,   to: 55866 },
    { rate: 0.08,  from: 55866,   to: 70606 },
    { rate: 0.093, from: 70606,   to: 360659 },
    { rate: 0.103, from: 360659,  to: 432787 },
    { rate: 0.113, from: 432787,  to: 721314 },
    { rate: 0.123, from: 721314,  to: 1000000 },
    { rate: 0.133, from: 1000000, to: Infinity },
  ],
  mfj: [
    { rate: 0.01,  from: 0,       to: 21512 },
    { rate: 0.02,  from: 21512,   to: 50998 },
    { rate: 0.04,  from: 50998,   to: 80490 },
    { rate: 0.06,  from: 80490,   to: 111732 },
    { rate: 0.08,  from: 111732,  to: 141212 },
    { rate: 0.093, from: 141212,  to: 721318 },
    { rate: 0.103, from: 721318,  to: 865574 },
    { rate: 0.113, from: 865574,  to: 1000000 },
    { rate: 0.123, from: 1000000, to: 1442628 },
    { rate: 0.133, from: 1442628, to: Infinity },
  ],
};

const QD_THRESHOLDS: Record<FilingStatus, [number, number]> = {
  single: [47025, 518900],
  mfj:    [94050, 583750],
};

function applyBrackets(
  taxableIncome: number,
  brackets: { rate: number; from: number; to: number }[],
): { tiers: BracketTier[]; totalTax: number; marginalRate: number; rothHeadroom: number; nextBracketRate: number } {
  let totalTax = 0;
  let marginalRate = brackets[0].rate;
  let rothHeadroom = 0;
  let nextBracketRate = brackets[0].rate;

  const tiers: BracketTier[] = brackets
    .filter(b => taxableIncome > b.from)
    .map((b) => {
      const incomeInBracket = Math.min(taxableIncome, b.to === Infinity ? taxableIncome : b.to) - b.from;
      const taxInBracket = incomeInBracket * b.rate;
      totalTax += taxInBracket;
      const isMarginal = taxableIncome > b.from && taxableIncome <= b.to;
      if (isMarginal || (b.to === Infinity && taxableIncome > b.from)) {
        marginalRate = b.rate;
        rothHeadroom = b.to === Infinity ? 0 : b.to - taxableIncome;
        // next bracket rate
        const nextIdx = brackets.findIndex(x => x.from === b.to);
        nextBracketRate = nextIdx !== -1 ? brackets[nextIdx].rate : b.rate;
      }
      return { rate: b.rate, from: b.from, to: b.to, incomeInBracket, taxInBracket, isMarginal };
    });

  return { tiers, totalTax, marginalRate, rothHeadroom, nextBracketRate };
}

export function computeTaxBreakdown(
  taxableIncome: number,
  filingStatus: FilingStatus,
): TaxBreakdown {
  if (taxableIncome <= 0) {
    return {
      taxableIncome: 0,
      federal: { tiers: [], totalTax: 0, marginalRate: 0.10, effectiveRate: 0, rothHeadroom: 0, nextBracketRate: 0.12 },
      california: { tiers: [], totalTax: 0, marginalRate: 0.01, effectiveRate: 0 },
      combined: { totalTax: 0, effectiveRate: 0 },
      qdRate: 0,
    };
  }

  const fed = applyBrackets(taxableIncome, FEDERAL_BRACKETS[filingStatus]);
  const ca  = applyBrackets(taxableIncome, CA_BRACKETS[filingStatus]);

  const [qd0, qd15] = QD_THRESHOLDS[filingStatus];
  const qdRate = taxableIncome <= qd0 ? 0 : taxableIncome <= qd15 ? 0.15 : 0.20;

  return {
    taxableIncome,
    federal: {
      tiers: fed.tiers,
      totalTax: fed.totalTax,
      marginalRate: fed.marginalRate,
      effectiveRate: taxableIncome > 0 ? fed.totalTax / taxableIncome : 0,
      rothHeadroom: fed.rothHeadroom,
      nextBracketRate: fed.nextBracketRate,
    },
    california: {
      tiers: ca.tiers,
      totalTax: ca.totalTax,
      marginalRate: ca.marginalRate,
      effectiveRate: taxableIncome > 0 ? ca.totalTax / taxableIncome : 0,
    },
    combined: {
      totalTax: fed.totalTax + ca.totalTax,
      effectiveRate: taxableIncome > 0 ? (fed.totalTax + ca.totalTax) / taxableIncome : 0,
    },
    qdRate,
  };
}

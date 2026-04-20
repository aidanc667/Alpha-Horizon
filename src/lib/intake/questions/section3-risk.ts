// ─── Section 3: Risk Profile ──────────────────────────────────────────────────

import type { Question } from './section1-goals';

export const SECTION_3_QUESTIONS: Question[] = [
  {
    id: 'q8_riskCapacity',
    section: 'Risk Profile',
    type: 'single_select',
    question: 'If your portfolio dropped 30% in a year, would you:',
    options: [
      'Be financially devastated — need to sell to cover expenses',
      'Be uncomfortable but could weather it — no forced selling',
      'Be fine — have other income/assets to sustain lifestyle',
      'Be opportunistic — would invest more',
    ],
    required: true,
    helpText: 'Your financial ability to withstand losses',
  },

  {
    id: 'q9_riskWillingness',
    section: 'Risk Profile',
    type: 'single_select',
    question: 'Imagine the market drops 20% overnight. You would most likely:',
    options: [
      'Panic and sell to "stop the bleeding"',
      'Do nothing and wait for recovery',
      'Buy more — "stocks are on sale"',
      'Not check my portfolio — long-term focused',
    ],
    required: true,
    helpText: 'Your emotional comfort with market volatility',
  },

  {
    id: 'q10_incomeStability',
    section: 'Risk Profile',
    type: 'single_select',
    question: 'How stable is your income?',
    options: [
      'Very stable — salaried W-2, tenure >5 years',
      'Stable — salaried but <5 years tenure, or contract role',
      'Variable — sales/commission/bonus-heavy (30%+ of income)',
      'Highly variable — freelance/self-employed/seasonal',
      'Retired — living on portfolio/Social Security/pension',
    ],
    required: true,
    helpText: 'Affects how much emergency fund you need',
  },
];

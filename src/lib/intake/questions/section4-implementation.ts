// ─── Section 4: Implementation ────────────────────────────────────────────────

import type { Question } from './section1-goals';

export const SECTION_4_QUESTIONS: Question[] = [
  {
    id: 'q11_availableAccounts',
    section: 'Implementation',
    type: 'multi_select',
    question: 'Where will you hold these investments? (select all that apply)',
    options: [
      'Taxable brokerage account',
      'Roth IRA',
      'Traditional IRA or 401k',
      'SEP IRA or Solo 401k (self-employed)',
      'HSA (Health Savings Account)',
      '529 Education Savings Plan',
      'Trust or estate account',
    ],
    required: true,
    helpText: 'Different account types have different tax treatments',
  },

  {
    id: 'q12_preferences',
    section: 'Implementation',
    type: 'optional_multi_part',
    question: 'Do you have any investment preferences or restrictions?',
    parts: [
      {
        id: 'noPreferences',
        type: 'boolean',
        label: 'No preferences — optimize purely for returns and risk',
        required: false,
      },
      {
        id: 'avoidInternational',
        type: 'boolean',
        label: 'Avoid international stocks (US-only portfolio)',
        required: false,
        showIf: { noPreferences: false },
      },
      {
        id: 'dividendFocus',
        type: 'boolean',
        label: 'Prefer dividend-focused investments (income > growth)',
        required: false,
        showIf: { noPreferences: false },
      },
      {
        id: 'indexOnly',
        type: 'boolean',
        label: 'Prefer index funds only (no factor tilts)',
        required: false,
        showIf: { noPreferences: false },
      },
      {
        id: 'esg',
        type: 'boolean',
        label: 'ESG/Sustainable investing (avoid fossil fuels, tobacco, etc.)',
        required: false,
        showIf: { noPreferences: false },
      },
      {
        id: 'other',
        type: 'text',
        label: 'Other preferences:',
        required: false,
        showIf: { noPreferences: false },
      },
    ],
    required: false,
    helpText: 'Optional — we recommend pure optimization for most investors',
  },
];

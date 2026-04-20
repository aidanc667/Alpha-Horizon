// ─── Section 2: Financial Situation ──────────────────────────────────────────

import type { Question } from './section1-goals';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

export const SECTION_2_QUESTIONS: Question[] = [
  {
    id: 'q4_startingCapital',
    section: 'Financial Situation',
    type: 'multi_part',
    question: 'How much are you investing today?',
    parts: [
      {
        id: 'amount',
        type: 'currency',
        label: 'Initial investment amount',
        required: true,
      },
      {
        id: 'hasExistingPortfolio',
        type: 'boolean',
        label: "Do you have an existing portfolio you're moving over?",
        required: true,
      },
      {
        id: 'existingPortfolioValue',
        type: 'currency',
        label: 'Approximate value of existing holdings',
        required: false,
        showIf: { hasExistingPortfolio: true },
      },
      {
        id: 'existingPortfolioType',
        type: 'select',
        label: 'Type of existing holdings',
        options: [
          'Individual stocks/bonds',
          'Mutual funds/ETFs',
          'Retirement accounts',
          'Mix of the above',
        ],
        required: false,
        showIf: { hasExistingPortfolio: true },
      },
    ],
    required: true,
    helpText: 'Include all money you plan to invest initially',
  },

  {
    id: 'q5_monthlyContribution',
    section: 'Financial Situation',
    type: 'multi_part',
    question: 'How much will you contribute each month?',
    parts: [
      {
        id: 'amount',
        type: 'currency',
        label: 'Monthly contribution amount',
        required: true,
      },
      {
        id: 'contributionConfidence',
        type: 'select',
        label: 'How confident are you in sustaining this?',
        options: [
          'Very confident — automatic payroll deduction',
          'Moderately confident — varies with bonus/income',
          'Uncertain — income is variable',
        ],
        required: true,
      },
    ],
    required: true,
    helpText: 'Consistent contributions compound significantly over time',
  },

  {
    id: 'q6_financialSnapshot',
    section: 'Financial Situation',
    type: 'multi_select',
    question: 'Select all that apply to your situation:',
    options: [
      'I have 3-6 months of expenses in emergency savings',
      'I have high-interest debt (credit cards, personal loans >8% APR)',
      "I'm maximizing my 401k employer match",
      'I have a planned large expense in the next 3 years',
      "I'm currently renting and plan to buy a home",
      'None of the above',
    ],
    followups: {
      'I have a planned large expense in the next 3 years': [
        {
          id: 'plannedExpenseAmount',
          type: 'currency',
          label: 'Expense amount',
          required: true,
        },
      ],
      "I'm currently renting and plan to buy a home": [
        {
          id: 'homePurchaseYears',
          type: 'number',
          label: 'Years until home purchase',
          required: true,
        },
      ],
    },
    required: true,
    helpText: 'These help us identify priorities and risks',
  },

  {
    id: 'q7_taxSituation',
    section: 'Financial Situation',
    type: 'multi_part',
    question: 'Tell us about your tax situation',
    parts: [
      {
        id: 'filingStatus',
        type: 'select',
        label: 'Filing status',
        options: ['Single', 'Married Filing Jointly', 'Head of Household'],
        required: true,
      },
      {
        id: 'annualIncome',
        type: 'currency',
        label: 'Approximate annual income',
        required: true,
      },
      {
        id: 'state',
        type: 'select',
        label: 'State of residence',
        options: US_STATES,
        required: true,
      },
      {
        id: 'age',
        type: 'number',
        label: 'Your age',
        required: true,
      },
      {
        id: 'traditionalBalance',
        type: 'currency',
        label: 'Traditional IRA/401k balance (optional)',
        required: false,
      },
      {
        id: 'rothBalance',
        type: 'currency',
        label: 'Roth IRA balance (optional)',
        required: false,
      },
      {
        id: 'hsaBalance',
        type: 'currency',
        label: 'HSA balance (optional)',
        required: false,
      },
    ],
    required: true,
    helpText: 'Critical for optimizing which accounts hold which investments',
  },
];

// ─── Section 1: Goals & Timeline ─────────────────────────────────────────────

export interface SubQuestion {
  id: string;
  type: 'number' | 'currency' | 'select';
  label: string;
  options?: string[];
  required?: boolean;
}

/** A single field within a multi_part question. */
export interface Part {
  id: string;
  type: 'currency' | 'number' | 'select' | 'boolean' | 'text';
  label: string;
  options?: string[];
  required?: boolean;
  /** When set, this part is only shown if the referenced sibling field equals the given value. */
  showIf?: Record<string, boolean | string>;
}

export interface Question {
  id: string;
  section: string;
  type: 'single_select' | 'multi_select' | 'currency' | 'number' | 'conditional' | 'multi_part' | 'optional_multi_part';
  question: string;
  options?: string[];
  /** Keyed by the option value from a preceding single_select question. */
  conditionalContent?: Record<string, SubQuestion[]>;
  /** Fields collected together in a multi_part question. */
  parts?: Part[];
  /** Follow-up sub-questions triggered by a specific multi_select option. */
  followups?: Record<string, SubQuestion[]>;
  required: boolean;
  helpText?: string;
}

// ─── Questions ────────────────────────────────────────────────────────────────

export const SECTION_1_QUESTIONS: Question[] = [
  {
    id: 'q1_goal',
    section: 'Goals & Timeline',
    type: 'single_select',
    question: 'What is your primary goal for this money?',
    options: [
      'Retirement (Financial Independence)',
      'Major Purchase (home, education, etc.)',
      'Wealth Accumulation (no specific target)',
      'Legacy/Estate Planning',
    ],
    required: true,
    helpText: 'This helps us determine the right balance between growth and stability',
  },

  {
    id: 'q2_goalDetails',
    section: 'Goals & Timeline',
    type: 'conditional',
    question: 'Tell us more about your goal',
    conditionalContent: {
      'Retirement (Financial Independence)': [
        {
          id: 'targetRetirementAge',
          type: 'number',
          label: 'What is your target retirement age?',
          required: true,
        },
        {
          id: 'annualIncomeNeeded',
          type: 'currency',
          label: 'What annual income do you need in retirement? (optional)',
          required: false,
        },
      ],
      'Major Purchase (home, education, etc.)': [
        {
          id: 'goalAmount',
          type: 'currency',
          label: 'How much do you need to save?',
          required: true,
        },
        {
          id: 'yearsToGoal',
          type: 'number',
          label: 'When do you need this money? (years from now)',
          required: true,
        },
      ],
      'Wealth Accumulation (no specific target)': [
        {
          id: 'goalAmount',
          type: 'currency',
          label: 'Do you have a target portfolio value? (optional)',
          required: false,
        },
      ],
      'Legacy/Estate Planning': [
        {
          id: 'goalAmount',
          type: 'currency',
          label: 'What is your target estate value?',
          required: true,
        },
        {
          id: 'yearsToGoal',
          type: 'number',
          label: 'When do you plan to transfer assets? (years)',
          required: true,
        },
      ],
    },
    required: true,
    helpText: 'Specific targets help us create a more accurate plan',
  },

  {
    id: 'q3_timeHorizon',
    section: 'Goals & Timeline',
    type: 'single_select',
    question: 'When will you start withdrawing from this portfolio?',
    options: [
      'Less than 3 years (short-term)',
      '3-7 years (medium-term)',
      '7-15 years (long-term)',
      '15+ years (very long-term)',
      'Never — this is legacy/perpetual wealth',
    ],
    required: true,
    helpText: 'Longer timeframes allow for higher growth investments',
  },
];

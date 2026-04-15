export const BUCKET_RATES = {
  SAFE:       0.04,
  GROWTH:     0.07,
  AGGRESSIVE: 0.10,
};

export const DEFAULT_ASSUMPTIONS = [
  'Monthly contributions are made at the beginning of each month.',
  `Bucket 1 (Safe) is projected at ${BUCKET_RATES.SAFE * 100}% annual return.`,
  `Bucket 2 (Growth) is projected at ${BUCKET_RATES.GROWTH * 100}% annual return.`,
  `Bucket 3 (Aggressive) is projected at ${BUCKET_RATES.AGGRESSIVE * 100}% annual return.`,
  'All dividends and interest are automatically reinvested.',
  'Calculations do not account for inflation or taxes on growth unless specified.',
];

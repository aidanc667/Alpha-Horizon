import { SECTION_1_QUESTIONS } from './section1-goals';
import { SECTION_2_QUESTIONS } from './section2-financial';
import { SECTION_3_QUESTIONS } from './section3-risk';
import { SECTION_4_QUESTIONS } from './section4-implementation';

export const INTAKE_QUESTIONS = [
  ...SECTION_1_QUESTIONS,
  ...SECTION_2_QUESTIONS,
  ...SECTION_3_QUESTIONS,
  ...SECTION_4_QUESTIONS,
];

export type { Question } from './section1-goals';

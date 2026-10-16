/** CARE framework + the two program ratings (Commitment, Satisfaction). */

export const CARE_CATEGORIES = ['contribution', 'alignment', 'relationships', 'energy'] as const;
export type CareCategory = (typeof CARE_CATEGORIES)[number];

export const PROGRAM_CATEGORIES = ['commitment', 'satisfaction'] as const;
export type ProgramCategory = (typeof PROGRAM_CATEGORIES)[number];

export const RATING_CATEGORIES = [...CARE_CATEGORIES, ...PROGRAM_CATEGORIES] as const;
export type RatingCategory = (typeof RATING_CATEGORIES)[number];

export function isRatingCategory(v: unknown): v is RatingCategory {
  return typeof v === 'string' && (RATING_CATEGORIES as readonly string[]).includes(v);
}
export function isCareCategory(v: unknown): v is CareCategory {
  return typeof v === 'string' && (CARE_CATEGORIES as readonly string[]).includes(v);
}

export interface CategoryMeta {
  key: RatingCategory;
  label: string;
  short: string;
  /** Sub-areas named by the CARE framework (empty for program ratings). */
  areas: string[];
  /** A one-line prompt used in check-in UIs. */
  prompt: string;
  /** Validated categorical color (see docs/DESIGN.md). */
  color: string;
  /** Soft tint of the color for backgrounds. */
  tint: string;
}

export const CATEGORY_META: Record<RatingCategory, CategoryMeta> = {
  contribution: {
    key: 'contribution',
    label: 'Contribution',
    short: 'C',
    areas: ['Personal growth', 'Professional growth'],
    prompt: 'How are you growing — personally and professionally?',
    color: '#eb6834',
    tint: '#fdeee7',
  },
  alignment: {
    key: 'alignment',
    label: 'Alignment',
    short: 'A',
    areas: ['Personal values', 'Higher purpose'],
    prompt: 'How aligned is your life with your values and purpose?',
    color: '#6250d6',
    tint: '#eeebfb',
  },
  relationships: {
    key: 'relationships',
    label: 'Relationships',
    short: 'R',
    areas: ['Relationships with others', 'Relationship with environment'],
    prompt: 'How are your relationships — with people and with your surroundings?',
    color: '#e87ba4',
    tint: '#fcebf2',
  },
  energy: {
    key: 'energy',
    label: 'Energy',
    short: 'E',
    areas: ['Physical vitality', 'Emotional vitality'],
    prompt: 'How is your physical and emotional energy?',
    color: '#1baf7a',
    tint: '#e4f6ee',
  },
  commitment: {
    key: 'commitment',
    label: 'Commitment',
    short: 'Cm',
    areas: [],
    prompt: 'How committed are you right now to pursuing and living your dreams?',
    color: '#2a78d6',
    tint: '#e6effb',
  },
  satisfaction: {
    key: 'satisfaction',
    label: 'Satisfaction',
    short: 'S',
    areas: [],
    prompt: 'How satisfied are you with your progress in the Dream Program?',
    color: '#c98500',
    tint: '#fbf1dc',
  },
};

export const RATING_MIN = 0;
export const RATING_MAX = 10;
export const PROGRESS_MIN = 0;
export const PROGRESS_MAX = 100;

import { z } from 'zod';

export const categorySchema = z.enum([
  'question',
  'research',
  'plan',
  'bug_fix',
  'feature',
  'refactor',
  'docs',
  'tests',
  'config',
  'review',
]);
export type Category = z.infer<typeof categorySchema>;

const CATEGORY_LABELS: Record<Category, string> = {
  question: 'Question',
  research: 'Research',
  plan: 'Plan',
  bug_fix: 'Bug fix',
  feature: 'Feature',
  refactor: 'Refactor',
  docs: 'Docs',
  tests: 'Tests',
  config: 'Config',
  review: 'Review',
};

export function categoryLabel(category: Category): string {
  return CATEGORY_LABELS[category];
}

const LEGACY_INTENTS: Record<string, Category> = {
  explain: 'question',
  fix: 'bug_fix',
  debugging: 'bug_fix',
  setup: 'config',
  chat: 'question',
};

export function upgradeLegacyCategory(value: unknown): unknown {
  return typeof value === 'string' ? (LEGACY_INTENTS[value] ?? value) : value;
}

export const titleSourceSchema = z.enum(['message', 'auto', 'user']);
export type TitleSource = z.infer<typeof titleSourceSchema>;

export const titleOriginSchema = z.enum(['agent', 'fallback']);
export type TitleOrigin = z.infer<typeof titleOriginSchema>;

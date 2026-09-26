import { z } from 'zod';

export const categorySchema = z.enum([
  'question',
  'debugging',
  'bug_fix',
  'feature',
  'refactor',
  'review',
  'research',
  'docs',
  'setup',
  'chat',
]);
export type Category = z.infer<typeof categorySchema>;

export const CATEGORY_CONFIDENCE_FLOOR = 0.5;

const CATEGORY_LABELS: Record<Category, string> = {
  question: 'Question',
  debugging: 'Debugging',
  bug_fix: 'Bug fix',
  feature: 'Feature',
  refactor: 'Refactor',
  review: 'Review',
  research: 'Research',
  docs: 'Docs',
  setup: 'Setup',
  chat: 'Chat',
};

export function categoryLabel(category: Category): string {
  return CATEGORY_LABELS[category];
}

const LEGACY_INTENTS: Record<string, Category> = {
  explain: 'question',
  fix: 'bug_fix',
};

export function upgradeLegacyCategory(value: unknown): unknown {
  return typeof value === 'string' ? (LEGACY_INTENTS[value] ?? value) : value;
}

export const titleSourceSchema = z.enum(['message', 'auto', 'user']);
export type TitleSource = z.infer<typeof titleSourceSchema>;

export const titleOriginSchema = z.enum(['agent', 'fallback']);
export type TitleOrigin = z.infer<typeof titleOriginSchema>;

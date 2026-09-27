import type { AgentRole, CardCategory, Category, Risk } from '@spark-outpost/contracts';

const FROM_INTENT: Readonly<Record<Category, CardCategory>> = {
  question: 'question',
  research: 'question',
  chat: 'question',
  docs: 'feature',
  debugging: 'fix',
  bug_fix: 'fix',
  feature: 'feature',
  setup: 'feature',
  refactor: 'refactor',
  review: 'review',
};

export function cardCategoryFor(
  role: AgentRole,
  intent: Category | null,
  risk: Risk,
): CardCategory | null {
  if (role === 'architect') return 'plan';
  if (role === 'critic') return 'review';
  if (risk === 'destructive') return 'destructive';
  return intent ? FROM_INTENT[intent] : null;
}

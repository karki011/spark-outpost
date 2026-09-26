import { describe, expect, it } from 'vitest';
import { adviceSummarySchema } from './advice.ts';
import { categoryLabel, categorySchema, upgradeLegacyCategory } from './categories.ts';

describe('categories', () => {
  it('offers the user-facing categories with plain labels', () => {
    expect(categorySchema.options.map(categoryLabel)).toEqual([
      'Question',
      'Debugging',
      'Bug fix',
      'Feature',
      'Refactor',
      'Review',
      'Research',
      'Docs',
      'Setup',
      'Chat',
    ]);
  });

  it('reads intents stored before categories as their closest category', () => {
    expect(upgradeLegacyCategory('explain')).toBe('question');
    expect(upgradeLegacyCategory('fix')).toBe('bug_fix');
    expect(upgradeLegacyCategory('refactor')).toBe('refactor');
    const rules = {
      intent: null,
      complexity: null,
      risk: 'read-only',
      injection: null,
      depth: 'direct',
      provider: 'claude',
      model: null,
      modelLabel: null,
      effort: null,
    };
    const stored = {
      purpose: 'intake',
      routing: 'pinned',
      rules,
      jev: { ...rules, intent: 'fix', confidence: 0.8, routeConfidence: null, confidences: {} },
      jevStatus: 'answered',
      jevError: null,
      jevModel: 'jev-1',
      gate: null,
      routeGate: null,
      wouldApply: 'jev',
      differences: [],
      latencyMs: 10,
      usage: null,
    };
    expect(adviceSummarySchema.parse(stored).jev?.intent).toBe('bug_fix');
  });
});

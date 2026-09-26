import { describe, expect, it } from 'vitest';
import { autoThisTurn, autoWouldHaveUsed, modelFamily } from './auto-route.ts';
import { member, orchestration } from './test-orchestration.ts';

describe('Auto routing labels', () => {
  it('shortens a model to its family', () => {
    expect(modelFamily({ model: 'sonnet-5', modelLabel: 'Sonnet 5 (1M context)' })).toBe('Sonnet');
    expect(modelFamily({ model: 'gpt-5-codex', modelLabel: null })).toBe('gpt');
    expect(modelFamily({ model: 'gpt-6-sol', modelLabel: '6 Sol' })).toBe('Sol');
  });

  it('names the model Auto chose for the working agent', () => {
    const crew = [
      member({ modelLabel: 'Haiku 4.5', role: 'scout' }),
      member({ status: 'running', modelLabel: 'Sonnet 5' }),
    ];
    expect(autoThisTurn(orchestration({ crew }))).toBe('Sonnet');
    expect(autoThisTurn(orchestration({ crew, routing: 'pinned' }))).toBeNull();
  });

  it('hints what Auto would have used with a pinned model', () => {
    const pick = { provider: 'claude', model: 'haiku-4.5', modelLabel: 'Haiku 4.5', effort: 'low' };
    const crew = [member({ autoWouldUse: pick })];
    expect(autoWouldHaveUsed(orchestration({ routing: 'pinned', crew }))).toBe('Haiku');
    const same = [member({ autoWouldUse: { ...pick, modelLabel: 'Sonnet 5' } })];
    expect(autoWouldHaveUsed(orchestration({ routing: 'pinned', crew: same }))).toBeNull();
  });
});

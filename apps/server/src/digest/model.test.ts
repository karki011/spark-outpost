import { describe, expect, it } from 'vitest';
import { digestModel } from './model.ts';

describe('digestModel', () => {
  it('picks the cheapest offered middle-or-top model at low effort, never the fast tier', () => {
    const offered = [
      { id: 'opus[1m]', label: 'Opus 5.5' },
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'haiku', label: 'Haiku 4.5' },
    ];
    expect(digestModel('claude', offered, ['low', 'high'])).toEqual({
      model: 'sonnet',
      label: 'Sonnet 5',
      effort: 'low',
    });
    expect(digestModel('codex', [{ id: 'gpt-6-sol' }, { id: 'gpt-6-luna' }], ['low'])).toEqual({
      model: 'gpt-6-sol',
      label: '6 Sol',
      effort: 'low',
    });
  });

  it('skips a retiring model', () => {
    const offered = [{ id: 'gpt-5.5' }, { id: 'gpt-5.6-sol' }];
    const today = new Date('2026-09-28T00:00:00Z');
    expect(digestModel('codex', offered, [], undefined, today).model).toBe('gpt-5.6-sol');
    const earlier = new Date('2026-08-01T00:00:00Z');
    expect(digestModel('codex', [{ id: 'gpt-5.5' }], [], undefined, earlier).model).toBe('gpt-5.5');
    expect(digestModel('codex', [{ id: 'gpt-5.5' }], [], undefined, today).model).toBeNull();
  });

  it('falls back to the cheapest card above the fast tier when nothing is offered yet', () => {
    expect(digestModel('zai', [], ['low'])).toMatchObject({
      model: 'glm-5.3',
      label: 'GLM-5.3',
    });
  });

  it('uses the agent default when no offered model has a card', () => {
    expect(digestModel('claude', [{ id: 'mystery' }], ['high'])).toEqual({
      model: null,
      label: null,
      effort: null,
    });
  });
});

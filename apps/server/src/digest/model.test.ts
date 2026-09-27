import { describe, expect, it } from 'vitest';
import { digestModel } from './model.ts';

describe('digestModel', () => {
  it('picks the cheapest offered non-frontier model at low effort', () => {
    const offered = [
      { id: 'opus[1m]', label: 'Opus 5.5' },
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'haiku', label: 'Haiku 4.5' },
    ];
    expect(digestModel('claude', offered, ['low', 'high'])).toEqual({
      model: 'haiku',
      label: 'Haiku 4.5',
      effort: 'low',
    });
    expect(digestModel('codex', [{ id: 'gpt-6-sol' }, { id: 'gpt-6-luna' }], ['low'])).toEqual({
      model: 'gpt-6-luna',
      label: '6 Luna',
      effort: 'low',
    });
  });

  it('falls back to the cheapest card when nothing is offered yet', () => {
    expect(digestModel('zai', [], ['low'])).toMatchObject({
      model: 'glm-5.3-flash',
      label: 'GLM-5.3-Flash',
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

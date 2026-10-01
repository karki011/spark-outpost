import { describe, expect, it } from 'vitest';
import type { Ratings } from '@spark-outpost/contracts';
import { jevRated, pinnedRule, pinnedStep, taskClearlySimple } from './pinned-builder.ts';

const rated = (complexity: number, stakes: number, confidence = 0.9): Ratings => ({
  complexity: { value: complexity, confidence },
  stakes: { value: stakes, confidence },
  ambiguity: { value: 2, confidence },
  contextDependence: { value: 2, confidence },
});

const opus = { provider: 'claude', model: 'opus[1m]', modelLabel: 'Opus 5.5', effort: 'high' };
const sonnet = { provider: 'claude', model: 'sonnet', modelLabel: 'Sonnet 5', effort: 'high' };

describe('a pinned chat routes its task Builder from the pin', () => {
  it('needs confident complexity and stakes ratings from Jev', () => {
    expect(jevRated(rated(2, 2))).toBe(true);
    expect(jevRated(rated(2, 2, 0.4))).toBe(false);
    expect(jevRated(null)).toBe(false);
  });

  it('calls a task clearly simple only on low, confident complexity and stakes', () => {
    expect(taskClearlySimple(rated(1, 2))).toBe(true);
    expect(taskClearlySimple(rated(3, 1))).toBe(false);
    expect(taskClearlySimple(rated(1, 3))).toBe(false);
    expect(taskClearlySimple(rated(1, 1, 0.55))).toBe(false);
  });

  it('says which way the Builder moved from the pinned model', () => {
    expect(pinnedStep(opus, sonnet)).toBe('below');
    expect(pinnedStep(sonnet, opus)).toBe('above');
    expect(pinnedStep(opus, opus)).toBe('same');
    expect(pinnedRule('below', opus)).toBe('Jev: clearly simple, below your pinned Opus 5.5');
    expect(pinnedRule('above', sonnet)).toBe('Jev: hard work, above your pinned Sonnet 5');
  });
});

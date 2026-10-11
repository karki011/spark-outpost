import { describe, expect, it } from 'vitest';
import { builderModels, floorModel, harnessModels } from './floor-model.ts';

const TODAY = new Date('2026-09-28T12:00:00Z');
const HAIKU = { id: 'haiku', label: 'Haiku 4.5' };
const SONNET = { id: 'sonnet', label: 'Sonnet 5' };
const OPUS = { id: 'opus[1m]', label: 'Opus 5.5' };

describe('the lowest model above the fast tier', () => {
  it('is the mid tier when the provider lists one', () => {
    expect(floorModel([HAIKU, OPUS, SONNET], 'claude', TODAY)).toEqual(SONNET);
  });

  it('is none when only the fast tier is listed', () => {
    expect(floorModel([HAIKU], 'claude', TODAY)).toBeNull();
  });

  it('lists the models above the fast tier lowest first', () => {
    expect(builderModels([OPUS, HAIKU, SONNET], 'claude', TODAY)).toEqual([SONNET, OPUS]);
  });

  it('keeps a model without a card', () => {
    const mystery = { id: 'mystery', label: 'Mystery 9' };
    expect(harnessModels([mystery, SONNET], 'claude', TODAY)).toEqual([mystery, SONNET]);
  });
});

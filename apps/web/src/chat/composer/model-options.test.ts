import { describe, expect, it } from 'vitest';
import {
  buttonLabel,
  cleanDescription,
  currentModel,
  formatTokens,
  meterLevel,
  optionLabel,
  retiringLabel,
  selectableEfforts,
  shortLabel,
  visibleModels,
} from './model-options.ts';

const capabilities = {
  provider: 'claude' as const,
  models: [
    { id: 'default', label: 'Default (recommended)', description: 'Opus 5.5' },
    { id: 'haiku', label: 'Haiku 4.5', description: null },
  ],
  efforts: [
    { id: 'default', label: 'Default', description: null },
    { id: 'low', label: 'Low', description: null },
    { id: 'high', label: 'High', description: null },
    { id: 'max', label: 'Max', description: null },
  ],
  defaultModel: 'default',
  modes: [],
  defaultMode: null,
  options: [],
  capturedAt: '2026-09-25T00:00:00.000Z',
};

describe('composer model options', () => {
  it('falls back to the agent default model and shortens its label', () => {
    const settings = {
      provider: 'claude' as const,
      model: null,
      effort: 'high',
      permission: null,
      agentMode: null,
      level: null,
      options: {},
    };
    expect(currentModel(settings, capabilities)?.id).toBe('default');
    expect(shortLabel('Default (recommended)')).toBe('Default');
    expect(currentModel({ ...settings, model: 'haiku' }, capabilities)?.label).toBe('Haiku 4.5');
    expect(buttonLabel(capabilities.models[0]!)).toBe('Opus 5.5');
    expect(currentModel({ ...settings, model: 'retired-model' }, capabilities)?.id).toBe('default');
    expect(
      buttonLabel({ id: 'default', label: 'Default', description: 'Opus (1M context) · Best' }),
    ).toBe('Opus');
    expect(buttonLabel(capabilities.models[1]!)).toBe('Haiku 4.5');
  });

  it('drops a description prefix that repeats the model name', () => {
    const option = (label: string, description: string | null) => ({ id: 'x', label, description });
    expect(cleanDescription(option('Sonnet 5', 'Sonnet 5 · Efficient for routine tasks'))).toBe(
      'Efficient for routine tasks',
    );
    expect(
      cleanDescription(option('Opus 5.5', 'Opus 5.5 with 1M context · Best for everyday tasks')),
    ).toBe('Best for everyday tasks');
    expect(cleanDescription(option('Default (recommended)', 'Opus (1M context)'))).toBe(
      'Opus (1M context)',
    );
    expect(cleanDescription(option('6 Sol', 'Workhorse model · for coding'))).toBe(
      'Workhorse model · for coding',
    );
    expect(cleanDescription(option('6 Sol', null))).toBeNull();
  });

  it('hides the agent default effort and maps effort to meter bars', () => {
    const efforts = selectableEfforts(capabilities);
    expect(efforts.map((effort) => effort.id)).toEqual(['low', 'high', 'max']);
    expect(meterLevel(efforts, 'low')).toBe(1);
    expect(meterLevel(efforts, 'high')).toBe(3);
    expect(meterLevel(efforts, 'max')).toBe(4);
    expect(meterLevel(efforts, 'unknown')).toBe(0);
  });

  it('formats token counts', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(18_783)).toBe('18.8K');
    expect(formatTokens(1_000_000)).toBe('1000K');
  });
});

describe('optionLabel', () => {
  it('marks the effective default model, never the agent default alias', () => {
    const capabilities = { defaultModel: 'gpt-6-sol' };
    expect(optionLabel({ id: 'gpt-6-sol', label: '6 Sol' }, capabilities)).toBe('6 Sol (default)');
    expect(optionLabel({ id: 'gpt-6-astra', label: '6 Astra' }, capabilities)).toBe('6 Astra');
    expect(
      optionLabel({ id: 'default', label: 'Default (recommended)' }, { defaultModel: 'default' }),
    ).toBe('Default (recommended)');
    expect(optionLabel({ id: 'gpt-6-sol', label: '6 Sol' }, undefined)).toBe('6 Sol');
  });
});

describe('retiring models', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  const models = [
    { id: 'haiku', label: 'Haiku 4.5', description: null, retiresNotBefore: '2026-10-15' },
    { id: 'sonnet', label: 'Sonnet 5', description: null, retiresNotBefore: '2027-06-30' },
    { id: 'old', label: 'Old', description: null, retiresNotBefore: '2026-01-01' },
    { id: 'sol', label: '6 Sol', description: null },
  ];

  it('hides models retiring within 30 days unless shown or currently picked', () => {
    const ids = (list: { id: string }[]) => list.map((model) => model.id);
    expect(ids(visibleModels(models, 'sonnet', false, now))).toEqual(['sonnet', 'sol']);
    expect(ids(visibleModels(models, 'haiku', false, now))).toEqual(['haiku', 'sonnet', 'sol']);
    expect(ids(visibleModels(models, 'sonnet', true, now))).toEqual([
      'haiku',
      'sonnet',
      'old',
      'sol',
    ]);
  });

  it('labels a retiring or retired model with its plain date', () => {
    expect(retiringLabel(models[0]!, now)).toBe('Retiring Oct 15, 2026');
    expect(retiringLabel(models[2]!, now)).toBe('Retired Jan 1, 2026');
    expect(
      retiringLabel({ id: 'gone', label: 'Gone', description: null, retired: true }, now),
    ).toBe('Retired');
    expect(retiringLabel(models[1]!, now)).toBeNull();
    expect(retiringLabel(models[3]!, now)).toBeNull();
  });
});

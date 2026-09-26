import { describe, expect, it } from 'vitest';
import {
  buttonLabel,
  cleanDescription,
  contextLevel,
  currentModel,
  formatTokens,
  meterLevel,
  selectableEfforts,
  shortLabel,
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
  capturedAt: '2026-09-25T00:00:00.000Z',
};

describe('composer model options', () => {
  it('falls back to the agent default model and shortens its label', () => {
    const settings = {
      provider: 'claude' as const,
      model: null,
      effort: 'high',
      permission: null,
      level: null,
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

  it('formats token counts and context levels', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(18_783)).toBe('18.8K');
    expect(formatTokens(1_000_000)).toBe('1000K');
    expect(contextLevel(10)).toBe('ok');
    expect(contextLevel(60)).toBe('warm');
    expect(contextLevel(90)).toBe('hot');
  });
});

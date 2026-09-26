import { describe, expect, it } from 'vitest';
import { modelName, prettyModelId } from './model-names.ts';

const claude = [
  { id: 'opus[1m]', label: 'Opus 5.5' },
  { id: 'haiku', label: 'Haiku 4.5 (fast)' },
];

describe('model names', () => {
  it('uses the provider catalog label', () => {
    expect(modelName(claude, 'opus[1m]')).toBe('Opus 5.5');
    expect(modelName(claude, 'haiku')).toBe('Haiku 4.5');
  });

  it('falls back to a readable name for ids missing from the catalog', () => {
    expect(modelName([], 'opus[1m]')).toBe('Opus');
    expect(prettyModelId('claude-sonnet-5-1')).toBe('Sonnet 5.1');
    expect(prettyModelId('claude-haiku-4')).toBe('Haiku 4');
    expect(prettyModelId('gpt-6-sol')).toBe('gpt-6-sol');
  });

  it('names the default model plainly', () => {
    expect(modelName(claude, null)).toBe('Default model');
    expect(modelName(claude, 'default')).toBe('Default model');
  });
});

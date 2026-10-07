import { describe, expect, it } from 'vitest';
import { standardUsage } from './run-usage.ts';

const tokens = { input: 100, output: 40, cachedRead: 700, cachedWrite: 50, thought: 10 };

describe('standardUsage', () => {
  it('adds cache tokens into the input total for providers that report them beside it', () => {
    expect(standardUsage({ provider: 'claude', model: 'sonnet', tokens })).toEqual({
      provider: 'claude',
      model: 'sonnet',
      inputTokens: 850,
      outputTokens: 40,
      totalTokens: 890,
      reasoningTokens: 10,
      cachedInputTokens: 700,
      cacheWriteInputTokens: 50,
    });
  });

  it('keeps the input total when the provider already counts cached tokens in it', () => {
    const usage = standardUsage({
      provider: 'codex',
      model: null,
      tokens: { input: 900, output: 300, cachedRead: 600, cachedWrite: null, thought: null },
    });
    expect(usage).toEqual({
      provider: 'codex',
      inputTokens: 900,
      outputTokens: 300,
      totalTokens: 1200,
      cachedInputTokens: 600,
    });
  });

  it('leaves out a reasoning count that cannot be part of the output total', () => {
    const usage = standardUsage({
      provider: 'codex',
      model: null,
      tokens: { input: 5, output: 3, cachedRead: null, cachedWrite: null, thought: 9 },
    });
    expect(usage).not.toHaveProperty('reasoningTokens');
  });
});

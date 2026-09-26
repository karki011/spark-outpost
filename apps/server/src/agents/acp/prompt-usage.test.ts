import { describe, expect, it } from 'vitest';
import { promptTokens } from './prompt-usage.ts';

describe('promptTokens', () => {
  it('maps every reported token count from the prompt response', () => {
    expect(
      promptTokens({
        totalTokens: 1600,
        inputTokens: 1000,
        outputTokens: 400,
        thoughtTokens: 200,
        cachedReadTokens: 800,
        cachedWriteTokens: 50,
      }),
    ).toEqual([
      {
        kind: 'tokens',
        tokens: {
          input: 1000,
          output: 400,
          total: 1600,
          cachedRead: 800,
          cachedWrite: 50,
          thought: 200,
        },
      },
    ]);
  });

  it('leaves optional counts empty and derives a missing total', () => {
    expect(promptTokens({ inputTokens: 10, outputTokens: 5, totalTokens: Number.NaN })).toEqual([
      {
        kind: 'tokens',
        tokens: {
          input: 10,
          output: 5,
          total: 15,
          cachedRead: null,
          cachedWrite: null,
          thought: null,
        },
      },
    ]);
  });

  it('ignores missing or malformed usage', () => {
    expect(promptTokens(undefined)).toEqual([]);
    expect(promptTokens(null)).toEqual([]);
    expect(promptTokens({ inputTokens: -1, outputTokens: 5, totalTokens: 4 })).toEqual([]);
  });
});

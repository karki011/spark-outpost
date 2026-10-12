import { describe, expect, it } from 'vitest';
import { createTurnTokens } from './turn-tokens.ts';

const usage = {
  totalTokens: 29_908,
  inputTokens: 1_200,
  outputTokens: 2_708,
  cachedReadTokens: 24_000,
  cachedWriteTokens: 2_000,
};

const row = (model: string, totalTokens: number) => ({
  model,
  token_count: {
    totalTokens,
    inputTokens: Math.round(totalTokens * 0.1),
    cachedInputTokens: Math.round(totalTokens * 0.7),
    cachedWriteTokens: Math.round(totalTokens * 0.1),
    outputTokens: Math.round(totalTokens * 0.1),
    reasoningOutputTokens: 0,
  },
});

const quota = (...rows: ReturnType<typeof row>[]) => ({ quota: { model_usage: rows } });

const total = (outputs: ReturnType<ReturnType<typeof createTurnTokens>['add']>) =>
  outputs.flatMap((output) => (output.kind === 'tokens' ? [output.tokens] : [])).at(-1);

describe('the tokens of a turn', () => {
  it("counts the sub-agents the response's own usage leaves out, from the per-model tally", () => {
    const tokens = createTurnTokens(true);
    const counted = total(tokens.add({ usage, _meta: quota(row('claude-sonnet-5-5', 61_694)) }, 0));
    expect(counted).toMatchObject({
      total: 61_694,
      input: 6_169,
      output: 6_169,
      cachedRead: 43_186,
    });
  });

  it("keeps the main agent's own split and counts its sub-agents apart, so the parts add up", () => {
    const tokens = createTurnTokens(true);
    const own = {
      totalTokens: 56_350,
      inputTokens: 1_554,
      outputTokens: 916,
      cachedReadTokens: 27_418,
      cachedWriteTokens: 26_462,
    };
    const counted = total(
      tokens.add({ usage: own, _meta: quota(row('claude-sonnet-5-5', 58_477)) }, 46_894),
    )!;
    expect(counted).toEqual({
      input: 1_554,
      output: 916,
      cachedRead: 27_418,
      cachedWrite: 26_462,
      thought: null,
      subagents: 46_894,
      total: 103_244,
    });
    expect(
      counted.input +
        counted.output +
        counted.cachedRead! +
        counted.cachedWrite! +
        counted.subagents!,
    ).toBe(counted.total);
  });

  it('takes the per-model tally whole when it already holds more than the sub-agents reported', () => {
    const tokens = createTurnTokens(true);
    const counted = total(
      tokens.add({ usage, _meta: quota(row('claude-sonnet-5-5', 70_000)) }, 34_000),
    )!;
    expect(counted.total).toBe(70_000);
    expect(counted.subagents ?? null).toBeNull();
    expect(counted.input + counted.output + counted.cachedRead! + counted.cachedWrite!).toBe(
      70_000,
    );
  });

  it('keeps the usage as reported for an agent whose usage already holds its sub-agents', () => {
    const tokens = createTurnTokens(false);
    const counted = total(tokens.add({ usage, _meta: quota(row('gpt', 900_000)) }, 34_000));
    expect(counted).toEqual({
      input: 1_200,
      output: 2_708,
      total: 29_908,
      cachedRead: 24_000,
      cachedWrite: 2_000,
      thought: null,
    });
  });

  it('adds up the prompts of one run instead of keeping the last', () => {
    const tokens = createTurnTokens(false);
    tokens.add({ usage }, 0);
    expect(total(tokens.add({ usage }, 0))).toMatchObject({ total: 59_816, input: 2_400 });
  });

  it('says nothing for a response without usage', () => {
    expect(createTurnTokens(true).add({}, 10)).toEqual([]);
  });
});

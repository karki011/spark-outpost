import { describe, expect, it } from 'vitest';
import type { ModelPrice } from '../usage/prices.ts';
import type { TokenCounts, TranscriptRecord } from './native-transcript.ts';
import { createTurnUsage, estimatedCost } from './turn-usage.ts';

const NONE: TokenCounts = {
  input: 0,
  output: 0,
  cachedRead: 0,
  cachedWrite: 0,
  cachedWriteLong: 0,
  thought: 0,
};
const response = (
  responseId: string,
  tokens: Partial<TokenCounts>,
  model: string | null = 'big',
): Extract<TranscriptRecord, { kind: 'response' }> => ({
  kind: 'response',
  turnId: 'turn',
  responseId,
  model,
  tokens: { ...NONE, ...tokens },
});
const price = (inputPerMillion: number, extra: Partial<ModelPrice> = {}): ModelPrice => ({
  provider: 'claude',
  model: 'big',
  inputPerMillion,
  cachedInputPerMillion: inputPerMillion / 10,
  outputPerMillion: inputPerMillion * 5,
  cacheOutsideInput: true,
  cacheWritePerMillion: inputPerMillion * 1.25,
  ...extra,
});
const prices = (provider: string, model: string | null) =>
  model === 'big' ? price(4) : model === 'small' ? price(1, { model: 'small' }) : null;

describe('turn usage', () => {
  it('has nothing to report before a response with tokens arrives', () => {
    const turn = createTurnUsage('claude', prices);
    expect(turn.totals()).toBeNull();
    expect(turn.add(response('synthetic', {}, '<synthetic>'))).toBe(false);
    expect(turn.totals()).toBeNull();
  });

  it('counts a response once however often its record repeats, keeping its latest numbers', () => {
    const turn = createTurnUsage('claude', prices);
    expect(turn.add(response('a', { input: 2, output: 10 }))).toBe(true);
    expect(turn.add(response('a', { input: 2, output: 10 }))).toBe(false);
    expect(turn.add(response('a', { input: 2, output: 50 }))).toBe(true);
    expect(turn.add(response('b', { input: 3, output: 5, cachedRead: 100, thought: 4 }))).toBe(
      true,
    );
    expect(turn.totals()).toEqual({
      model: 'big',
      tokens: { input: 5, output: 55, total: 160, cachedRead: 100, cachedWrite: 0, thought: 4 },
      costUsd: 0.00116,
    });
  });

  it('prices each model at its own rate and a one-hour cache write at twice the input rate', () => {
    const turn = createTurnUsage('claude', prices);
    turn.add(response('a', { input: 1000, cachedWrite: 1000, cachedWriteLong: 600 }));
    turn.add(response('b', { output: 1000 }, 'small'));
    expect(turn.totals()).toMatchObject({ model: 'small', costUsd: 0.0158 });
    expect(estimatedCost(price(4), { ...NONE, cachedWrite: 10, cachedWriteLong: 500 })).toBe(
      0.00008,
    );
  });

  it('has no cost when a model that ran has no price, and still has the tokens', () => {
    const turn = createTurnUsage('claude', prices);
    turn.add(response('a', { input: 10, output: 10 }));
    turn.add(response('b', { input: 10, output: 10 }, 'unlisted'));
    expect(turn.totals()).toMatchObject({ costUsd: null, tokens: { input: 20, output: 20 } });
  });

  it('counts cached input inside the input for a provider that reports it that way', () => {
    const turn = createTurnUsage('codex', () =>
      price(2, { provider: 'codex', cacheOutsideInput: false }),
    );
    turn.add(response('turn', { input: 1000, cachedRead: 400, output: 100 }));
    expect(turn.totals()).toMatchObject({
      tokens: { input: 1000, output: 100, total: 1100, cachedRead: 400 },
      costUsd: 0.00228,
    });
  });

  it('starts again after it is cleared', () => {
    const turn = createTurnUsage('claude', prices);
    turn.add(response('a', { input: 2 }));
    turn.clear();
    expect(turn.totals()).toBeNull();
  });
});

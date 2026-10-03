import { describe, expect, it } from 'vitest';
import { agentRanking } from './observe-content.ts';
import type { Ranking } from './observe-rank.ts';

const ranking = (first: string): Ranking => ({
  files: [],
  predicted: [first],
  probabilities: new Map([[first, 0.9]]),
});

describe('which ranking agents receive', () => {
  const current = ranking('current.ts');
  const never = new Promise<Ranking | null>(() => undefined);

  it('is the current ranking while content ranking is observed only, without waiting for it', async () => {
    expect(await agentRanking(Promise.resolve(current), never)).toBe(current);
    expect(await agentRanking(Promise.resolve(current), never, false)).toBe(current);
  });

  it('is the content ranking once promoted, and the current one when content has none', async () => {
    const content = ranking('content.ts');
    expect(await agentRanking(Promise.resolve(current), Promise.resolve(content), true)).toBe(
      content,
    );
    expect(await agentRanking(Promise.resolve(current), Promise.resolve(null), true)).toBe(current);
  });
});

import { describe, expect, it } from 'vitest';
import { atK } from '../../apps/server/src/routing/labels.ts';
import {
  comparable,
  PROMOTE_MIN_TURNS,
  renderContentRank,
  summarise,
  verdict,
  type ContentRankLabel,
} from './content-rank.ts';

const changed = ['a', 'b'];

function label(current: string[], content: string[] | null, tokens = 4_000): ContentRankLabel {
  return {
    files: {
      scan: atK(current, changed),
      predicted: atK(current, changed),
      content: content ? atK(content, changed) : null,
    },
    contentRank: content ? { tokens, filesSent: 3, filesCached: 1, buildMs: 20 } : null,
  };
}

describe('content ranking report', () => {
  it('compares only turns that have a content ranking and known changed files', () => {
    const labels = [
      label(['a', 'x'], ['a', 'b']),
      label(['a', 'x'], null),
      { files: null, contentRank: null },
    ];
    expect(comparable(labels)).toHaveLength(1);
  });

  it('averages precision and recall at five for each ranking and counts wins', () => {
    const summary = summarise(
      comparable([
        label(['a', 'x'], ['a', 'b']),
        label(['a', 'b'], ['x', 'y']),
        label(['a'], ['a']),
      ]),
    );
    expect(summary).toMatchObject({ turns: 3, better: 1, worse: 1, same: 1, tokensPerTurn: 4_000 });
    expect(summary.current.recall).toBeCloseTo((0.5 + 1 + 0.5) / 3);
    expect(summary.content.recall).toBeCloseTo((1 + 0 + 0.5) / 3);
    expect(summary.cachedShare).toBe(0.25);
    expect(summary.buildMsMedian).toBe(20);
  });

  it('asks for more turns before any verdict', () => {
    const summary = summarise(comparable([label(['x'], ['a', 'b'])]));
    expect(verdict(summary)).toBe(`Keep observing: 1 labelled turns, ${PROMOTE_MIN_TURNS} needed.`);
  });

  it('supports promotion only when recall is clearly up and precision holds', () => {
    const many = (current: string[], content: string[]) =>
      summarise(
        comparable(Array.from({ length: PROMOTE_MIN_TURNS }, () => label(current, content))),
      );
    expect(verdict(many(['a', 'x'], ['a', 'b']))).toMatch(/^Supports promotion/);
    expect(verdict(many(['a', 'b'], ['a', 'b']))).toBe('Does not support promotion yet.');
    expect(verdict(many(['a', 'b'], ['a', 'x']))).toBe('Does not support promotion yet.');
  });

  it('prints both rankings side by side', () => {
    const text = renderContentRank(summarise(comparable([label(['a', 'x'], ['a', 'b'])])));
    expect(text).toContain('current (agents get)   0.50         0.50');
    expect(text).toContain('content (Jev previews) 1.00         1.00');
    expect(text).toContain('1 better, 0 worse, 0 the same');
  });
});

import { describe, expect, it } from 'vitest';
import type { AttentionReport } from '@spark-outpost/contracts';
import { attentionSources } from './attention-sources.ts';

function report(count: number): AttentionReport {
  return { count, requests: [] };
}

describe('attentionSources', () => {
  it('falls back to the page that is still open when the other closes', () => {
    const sources = attentionSources<string>();
    sources.report('window', report(2));
    sources.report('island', report(3));
    expect(sources.gone('island')).toEqual(report(2));
  });

  it('falls back to the latest report among the pages left', () => {
    const sources = attentionSources<string>();
    sources.report('window', report(1));
    sources.report('island', report(2));
    sources.report('window', report(4));
    sources.report('other', report(9));
    expect(sources.gone('other')).toEqual(report(4));
  });

  it('has nothing to fall back to once the last page closes', () => {
    const sources = attentionSources<string>();
    sources.report('window', report(2));
    expect(sources.gone('window')).toBeNull();
    expect(sources.has('window')).toBe(false);
  });

  it('knows which pages have reported', () => {
    const sources = attentionSources<string>();
    sources.report('window', report(0));
    expect(sources.has('window')).toBe(true);
    expect(sources.has('island')).toBe(false);
  });
});

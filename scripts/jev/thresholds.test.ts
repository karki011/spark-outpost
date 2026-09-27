import { describe, expect, it } from 'vitest';
import { renderTable, thresholdTable } from './thresholds.ts';

describe('threshold report', () => {
  it('computes precision and recall per threshold', () => {
    const samples = [
      { score: 0.95, positive: true },
      { score: 0.9, positive: false },
      { score: 0.6, positive: true },
      { score: 0.2, positive: false },
    ];
    const [atHalf, , , , , atNinety] = thresholdTable(samples);
    expect(atHalf).toEqual({
      threshold: 0.5,
      flagged: 3,
      truePositives: 2,
      precision: 2 / 3,
      recall: 1,
    });
    expect(atNinety).toMatchObject({ threshold: 0.9, flagged: 2, precision: 0.5, recall: 0.5 });
    expect(renderTable('policy', samples)).toContain('policy: 4 observations, 2 labelled bad');
  });

  it('reports no precision when nothing is flagged', () => {
    expect(thresholdTable([{ score: 0.1, positive: true }])[0]).toMatchObject({
      precision: null,
      recall: 0,
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { AnalyticsSpend } from '@spark-outpost/contracts';
import { sourceSummary } from '../analytics/spend-summaries.ts';

describe('the Spend tab source line', () => {
  it('spells "reported" correctly', () => {
    const data = { totalUsd: 2, reportedUsd: 1, estimatedUsd: 1 } as AnalyticsSpend;
    expect(sourceSummary(data)).toContain('was reported by providers');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AnalyticsSpend } from '@spark-outpost/contracts';
import { spendCsv } from '../analytics/spend-csv.ts';

function spend(leaves: AnalyticsSpend['leaves']): AnalyticsSpend {
  return {
    window: { range: '30d', from: '2026-09-01', to: '2026-09-30', days: 30, timeZone: 'UTC' },
    totalUsd: 0,
    reportedUsd: 0,
    estimatedUsd: 0,
    unpricedRuns: 0,
    jev: { calls: 0, costUsd: 0 },
    leaves,
    days: [],
    perTask: [],
    finishedTasks: 0,
    costPerGoodUsd: null,
    resume: { resumedRuns: 0, sessionRuns: 0, cachedTokens: 0, savedUsd: 0 },
  } as AnalyticsSpend;
}

const leaf = (project: string, costUsd: number) => ({
  project,
  provider: 'claude',
  model: 'sonnet',
  modelLabel: 'Sonnet 5',
  runs: 3,
  costUsd,
  reportedUsd: costUsd,
  estimatedUsd: 0,
});

const HEADER = 'project,provider,model,runs,cost_usd,reported_usd,estimated_usd';

describe('spend CSV export', () => {
  it('writes only the header when nothing was spent', () => {
    expect(spendCsv(spend([]))).toBe(`${HEADER}\n`);
  });

  it('writes one row per leaf in order, with four decimals', () => {
    const lines = spendCsv(spend([leaf('api', 1.5), leaf('web', 0.12346)])).split('\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe('api,claude,sonnet,3,1.5000,1.5000,0.0000');
    expect(lines[2]).toBe('web,claude,sonnet,3,0.1235,0.1235,0.0000');
    expect(lines[3]).toBe('');
    expect(lines).toHaveLength(4);
  });

  it('quotes fields with commas and quotes', () => {
    const csv = spendCsv(spend([leaf('acme, "north"', 1)]));
    expect(csv.split('\n')[1]).toBe('"acme, ""north""",claude,sonnet,3,1.0000,1.0000,0.0000');
  });

  it('is offered on the Spend tab', () => {
    const tab = readFileSync(join(import.meta.dirname, '../analytics/SpendTab.tsx'), 'utf8');
    expect(tab).toMatch(/spend-csv/);
    expect(tab).toMatch(/export csv/i);
  });
});

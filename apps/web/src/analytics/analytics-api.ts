import {
  analyticsHarnessSchema,
  analyticsOverviewSchema,
  analyticsSpendSchema,
  type AnalyticsHarness,
  type AnalyticsOverview,
  type AnalyticsRange,
  type AnalyticsSpend,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';
import { viewerTimeZone } from '../home/home-api.ts';

export interface RangeChoice {
  range: AnalyticsRange;
  from: string;
  to: string;
}

export type AnalyticsTab = 'overview' | 'spend' | 'harness';

export const analyticsKeys = {
  all: ['analytics'] as const,
  tab: (tab: AnalyticsTab, choice: RangeChoice) =>
    [
      'analytics',
      tab,
      choice.range,
      choice.range === 'custom' ? `${choice.from}..${choice.to}` : '',
    ] as const,
};

function query(choice: RangeChoice): string {
  const params = new URLSearchParams({ range: choice.range, tz: viewerTimeZone() });
  if (choice.range === 'custom') {
    params.set('from', choice.from);
    params.set('to', choice.to);
  }
  return params.toString();
}

export const analyticsApi = {
  overview: (choice: RangeChoice): Promise<AnalyticsOverview> =>
    request(analyticsOverviewSchema, `/analytics/overview?${query(choice)}`),
  spend: (choice: RangeChoice): Promise<AnalyticsSpend> =>
    request(analyticsSpendSchema, `/analytics/spend?${query(choice)}`),
  harness: (choice: RangeChoice): Promise<AnalyticsHarness> =>
    request(analyticsHarnessSchema, `/analytics/harness?${query(choice)}`),
};

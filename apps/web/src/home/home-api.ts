import {
  digestStateSchema,
  providerHealthSchema,
  type DigestState,
  type DigestTrigger,
  spendSummarySchema,
  type ProviderHealth,
  type SpendRange,
  type SpendSummary,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const homeKeys = {
  all: ['home'] as const,
  spend: (range: SpendRange) => ['home', 'spend', range] as const,
  health: ['home', 'provider-health'] as const,
  digest: ['home', 'digest'] as const,
};

function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export const homeApi = {
  spend: (range: SpendRange): Promise<SpendSummary> =>
    request(
      spendSummarySchema,
      `/usage/spend?${new URLSearchParams({ range, tz: viewerTimeZone() }).toString()}`,
    ),
  health: (): Promise<ProviderHealth> => request(providerHealthSchema, '/providers/health'),
  digest: (): Promise<DigestState> => request(digestStateSchema, '/home/digest'),
  requestDigest: (trigger: DigestTrigger): Promise<DigestState> =>
    request(
      digestStateSchema,
      `/home/digest?${new URLSearchParams({ tz: viewerTimeZone() }).toString()}`,
      { method: 'POST', body: JSON.stringify({ trigger }) },
    ),
};

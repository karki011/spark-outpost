import { z } from 'zod';
import {
  allowFrontierSchema,
  modelCardsResponseSchema,
  type AllowFrontier,
  type ModelCardsResponse,
  type ProviderId,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const modelCardsKey = ['model-cards'] as const;

export const modelCardsApi = {
  get: (): Promise<ModelCardsResponse> => request(modelCardsResponseSchema, '/model-cards'),
  setFrontier: (provider: ProviderId, allowed: boolean): Promise<AllowFrontier> =>
    request(
      z.object({ allowFrontier: allowFrontierSchema }).transform((body) => body.allowFrontier),
      `/model-cards/frontier/${provider}`,
      { method: 'PUT', body: JSON.stringify({ allowed }) },
    ),
};

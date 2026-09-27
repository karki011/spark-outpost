import { modelCardsResponseSchema, type ModelCardsResponse } from '@spark-outpost/contracts';
import { request } from './client.ts';

export const modelCardsKey = ['model-cards'] as const;

export const modelCardsApi = {
  get: (): Promise<ModelCardsResponse> => request(modelCardsResponseSchema, '/model-cards'),
};

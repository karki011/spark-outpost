import {
  outcomeResponseSchema,
  type OutcomeResponse,
  type SaveFeedbackRequest,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const outcomeKeys = {
  all: ['outcome'] as const,
  run: (runId: string) => ['outcome', runId] as const,
};

export const outcomesApi = {
  get: (runId: string): Promise<OutcomeResponse> =>
    request(outcomeResponseSchema, `/runs/${runId}/outcome`),
  saveFeedback: (runId: string, feedback: SaveFeedbackRequest): Promise<OutcomeResponse> =>
    request(outcomeResponseSchema, `/runs/${runId}/feedback`, {
      method: 'PUT',
      body: JSON.stringify(feedback),
    }),
};

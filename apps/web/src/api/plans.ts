import {
  planDocumentSchema,
  type PlanDocument,
  type SavePlanRequest,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const plansApi = {
  save: (conversationId: string, plan: SavePlanRequest): Promise<PlanDocument> =>
    request(planDocumentSchema, `/conversations/${conversationId}/plans`, {
      method: 'POST',
      body: JSON.stringify(plan),
    }),
};

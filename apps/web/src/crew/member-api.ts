import { memberMessageResponseSchema, type MemberMessageResponse } from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const memberApi = {
  send: (runId: string, id: string, text: string, resume = false): Promise<MemberMessageResponse> =>
    request(memberMessageResponseSchema, `/runs/${runId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ id, text, continue: resume }),
    }),
};

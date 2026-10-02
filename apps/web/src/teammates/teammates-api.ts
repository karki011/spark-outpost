import { z } from 'zod';
import {
  teammateChatSchema,
  teammateListSchema,
  teammateSchema,
  type CreateTeammateRequest,
  type Teammate,
  type TeammateChat,
  type TeammateList,
  type TeammateStarterId,
  type UpdateTeammateRequest,
} from '@spark-outpost/contracts';
import { forgetDraft, request } from '../api/client.ts';

export const teammateKeys = {
  all: ['teammates'] as const,
};

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export const teammatesApi = {
  list: (): Promise<TeammateList> => request(teammateListSchema, '/teammates'),
  create: (input: CreateTeammateRequest): Promise<Teammate> =>
    request(teammateSchema, '/teammates', json('POST', input)),
  update: (id: string, update: UpdateTeammateRequest): Promise<Teammate> =>
    request(teammateSchema, `/teammates/${id}`, json('PATCH', update)),
  remove: (id: string): Promise<null> =>
    request(z.null(), `/teammates/${id}`, { method: 'DELETE' }),
  openHome: (id: string): Promise<TeammateChat> =>
    request(teammateChatSchema, `/teammates/${id}/home`, json('POST', {})),
  talkTo: async (conversationId: string, teammateId: string | null): Promise<TeammateChat> => {
    const linked = await request(
      teammateChatSchema,
      `/conversations/${conversationId}/teammate`,
      json('PUT', { teammateId }),
    );
    forgetDraft(conversationId);
    return linked;
  },
  dismissStarter: (starter: TeammateStarterId): Promise<null> =>
    request(z.null(), `/teammate-starters/${starter}/dismiss`, json('POST', {})),
};

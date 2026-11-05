import { z } from 'zod';
import {
  attentionListSchema,
  type AttentionList,
  type AttentionMark,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const attentionKey = ['attention'] as const;

export const attentionApi = {
  list: (): Promise<AttentionList> => request(attentionListSchema, '/attention'),
  mark: (key: string, mark: AttentionMark): Promise<null> =>
    request(z.null(), `/attention/${encodeURIComponent(key)}/${mark}`, {
      method: 'POST',
      body: '{}',
    }),
  readChat: (conversationId: string): Promise<null> =>
    request(z.null(), `/attention/chats/${conversationId}/read`, { method: 'POST', body: '{}' }),
};

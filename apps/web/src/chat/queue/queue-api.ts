import { queueResponseSchema, type QueueResponse } from '@spark-outpost/contracts';
import { request } from '../../api/client.ts';

const path = (conversationId: string, rest = '') => `/conversations/${conversationId}/queue${rest}`;

export const queueApi = {
  add: (
    conversationId: string,
    id: string,
    content: string,
    origin?: 'voice' | 'pages',
    attachmentIds: readonly string[] = [],
  ): Promise<QueueResponse> =>
    request(queueResponseSchema, path(conversationId), {
      method: 'POST',
      body: JSON.stringify({
        id,
        content,
        ...(origin ? { origin } : {}),
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      }),
    }),
  edit: (conversationId: string, id: string, content: string): Promise<QueueResponse> =>
    request(queueResponseSchema, path(conversationId, `/${id}`), {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),
  order: (conversationId: string, ids: readonly string[]): Promise<QueueResponse> =>
    request(queueResponseSchema, path(conversationId, '/order'), {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    }),
  remove: (conversationId: string, id: string): Promise<QueueResponse> =>
    request(queueResponseSchema, path(conversationId, `/${id}`), {
      method: 'DELETE',
      body: '{}',
    }),
  sendFirst: (conversationId: string, id: string, content: string): Promise<QueueResponse> =>
    request(queueResponseSchema, path(conversationId, '/send-now'), {
      method: 'POST',
      body: JSON.stringify({ id, content }),
    }),
  sendNow: (conversationId: string, id: string): Promise<QueueResponse> =>
    request(queueResponseSchema, path(conversationId, `/${id}/send-now`), {
      method: 'POST',
      body: '{}',
    }),
  resendSteer: (conversationId: string, id: string): Promise<QueueResponse> =>
    request(queueResponseSchema, `/conversations/${conversationId}/steers/${id}/resend`, {
      method: 'POST',
      body: '{}',
    }),
  dropSteer: (conversationId: string, id: string): Promise<QueueResponse> =>
    request(queueResponseSchema, `/conversations/${conversationId}/steers/${id}`, {
      method: 'DELETE',
      body: '{}',
    }),
};

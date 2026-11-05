import {
  chatContextResponseSchema,
  chatLinkResponseSchema,
  type ChatContextResponse,
  type ChatLinkResponse,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const chatShareApi = {
  link: (chatId: string): Promise<ChatLinkResponse> =>
    request(chatLinkResponseSchema, `/conversations/${chatId}/share`),
  context: (reference: string, signal?: AbortSignal): Promise<ChatContextResponse> =>
    request(chatContextResponseSchema, '/chat-context', {
      method: 'POST',
      body: JSON.stringify({ reference }),
      ...(signal ? { signal } : {}),
    }),
};

import { chatUpdateSchema, sparkAssistantSchema, type ChatUpdate } from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const islandKeys = {
  assistant: ['spark-assistant'] as const,
};

export const islandApi = {
  chatUpdate: (conversationId: string): Promise<ChatUpdate> =>
    request(chatUpdateSchema, `/conversations/${conversationId}/update`, {
      method: 'POST',
      body: '{}',
    }),
  assistant: (): Promise<string> =>
    request(sparkAssistantSchema, '/spark-assistant', { method: 'POST', body: '{}' }).then(
      (result) => result.conversationId,
    ),
};

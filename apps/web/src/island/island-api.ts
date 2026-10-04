import {
  chatUpdateSchema,
  fileViewResponseSchema,
  sparkAssistantSchema,
  type ChatUpdate,
  type FileViewResponse,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const islandKeys = {
  assistant: ['spark-assistant'] as const,
  fileView: (conversationId: string, step: string) =>
    ['island-file-view', conversationId, step] as const,
};

export const islandApi = {
  chatUpdate: (conversationId: string): Promise<ChatUpdate> =>
    request(chatUpdateSchema, `/conversations/${conversationId}/update`, {
      method: 'POST',
      body: '{}',
    }),
  fileView: (conversationId: string): Promise<FileViewResponse> =>
    request(fileViewResponseSchema, `/conversations/${conversationId}/file-view`),
  assistant: (): Promise<string> =>
    request(sparkAssistantSchema, '/spark-assistant', { method: 'POST', body: '{}' }).then(
      (result) => result.conversationId,
    ),
};

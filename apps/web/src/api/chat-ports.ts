import { chatPortsResponseSchema, type ChatPortsResponse } from '@spark-outpost/contracts';
import { request } from './client.ts';

export const chatPortsKey = ['chat-ports'] as const;

export function fetchChatPorts(): Promise<ChatPortsResponse> {
  return request(chatPortsResponseSchema, '/chat-ports');
}

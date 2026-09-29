import {
  chatMcpListSchema,
  userMcpListSchema,
  type ChatMcpList,
  type McpCopySecretsRequest,
  type McpEnableRequest,
  type SaveUserMcpRequest,
  type UserMcpList,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const userMcpKey = ['mcp', 'servers'] as const;
export const chatMcpRoot = ['mcp', 'chat'] as const;
export const chatMcpKey = (conversationId: string) => [...chatMcpRoot, conversationId] as const;

const send = (path: string, method: string, body?: object) =>
  request(userMcpListSchema, path, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

export const mcpApi = {
  list: (): Promise<UserMcpList> => request(userMcpListSchema, '/mcp/servers'),
  scan: (): Promise<UserMcpList> => send('/mcp/scan', 'POST'),
  add: (body: SaveUserMcpRequest): Promise<UserMcpList> => send('/mcp/servers', 'POST', body),
  edit: (id: string, body: SaveUserMcpRequest): Promise<UserMcpList> =>
    send(`/mcp/servers/${id}`, 'PUT', body),
  remove: (id: string): Promise<UserMcpList> => send(`/mcp/servers/${id}`, 'DELETE'),
  enable: (id: string, body: McpEnableRequest): Promise<UserMcpList> =>
    send(`/mcp/servers/${id}/enable`, 'PUT', body),
  copySecrets: (id: string, body: McpCopySecretsRequest): Promise<UserMcpList> =>
    send(`/mcp/servers/${id}/copy-secrets`, 'POST', body),
  test: (id: string): Promise<UserMcpList> => send(`/mcp/servers/${id}/test`, 'POST'),
  forChat: (conversationId: string): Promise<ChatMcpList> =>
    request(chatMcpListSchema, `/conversations/${conversationId}/mcp`),
};

import {
  chatMcpListSchema,
  mcpSignInFlowSchema,
  userMcpListSchema,
  type ChatMcpList,
  type McpEnableRequest,
  type McpSignInFlow,
  type SaveUserMcpRequest,
  type UserMcpList,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const userMcpKey = ['mcp', 'servers'] as const;
export const mcpSignInKey = (id: string) => ['mcp', 'sign-in', id] as const;
export const chatMcpRoot = ['mcp', 'chat'] as const;
export const chatMcpKey = (conversationId: string) => [...chatMcpRoot, conversationId] as const;

const send = (path: string, method: string, body?: object) =>
  request(userMcpListSchema, path, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

export const mcpApi = {
  list: (): Promise<UserMcpList> => request(userMcpListSchema, '/mcp/servers'),
  add: (body: SaveUserMcpRequest): Promise<UserMcpList> => send('/mcp/servers', 'POST', body),
  edit: (id: string, body: SaveUserMcpRequest): Promise<UserMcpList> =>
    send(`/mcp/servers/${id}`, 'PUT', body),
  remove: (id: string): Promise<UserMcpList> => send(`/mcp/servers/${id}`, 'DELETE'),
  enable: (id: string, body: McpEnableRequest): Promise<UserMcpList> =>
    send(`/mcp/servers/${id}/enable`, 'PUT', body),
  test: (id: string): Promise<UserMcpList> => send(`/mcp/servers/${id}/test`, 'POST'),
  signInFlow: (id: string): Promise<McpSignInFlow> =>
    request(mcpSignInFlowSchema, `/mcp/servers/${id}/sign-in`),
  startSignIn: (id: string): Promise<McpSignInFlow> =>
    request(mcpSignInFlowSchema, `/mcp/servers/${id}/sign-in`, { method: 'POST', body: '{}' }),
  cancelSignIn: (id: string): Promise<McpSignInFlow> =>
    request(mcpSignInFlowSchema, `/mcp/servers/${id}/sign-in`, { method: 'DELETE' }),
  signOut: (id: string): Promise<UserMcpList> => send(`/mcp/servers/${id}/sign-out`, 'POST'),
  forChat: (conversationId: string): Promise<ChatMcpList> =>
    request(chatMcpListSchema, `/conversations/${conversationId}/mcp`),
};

import {
  agentTerminalListSchema,
  agentTerminalSchema,
  commandOutputResponseSchema,
  createShellResponseSchema,
  type AgentTerminal,
  type CommandOutputResponse,
  type CreateShellResponse,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const agentTerminalKeys = {
  all: ['agent-terminals'] as const,
  chat: (conversationId: string) => ['agent-terminals', 'chat', conversationId] as const,
  output: (conversationId: string, id: string) =>
    ['agent-terminals', 'output', conversationId, id] as const,
};

const at = (conversationId: string, id: string, rest: string) =>
  `/conversations/${conversationId}/agent-terminals/${id}/${rest}`;

const POST: RequestInit = { method: 'POST', body: '{}' };

export const agentTerminalsApi = {
  list: async (conversationId: string): Promise<AgentTerminal[]> => {
    const path = `/conversations/${conversationId}/agent-terminals`;
    return (await request(agentTerminalListSchema, path)).terminals;
  },
  output: (conversationId: string, id: string): Promise<CommandOutputResponse> =>
    request(commandOutputResponseSchema, at(conversationId, id, 'output')),
  view: (conversationId: string, id: string): Promise<CreateShellResponse> =>
    request(createShellResponseSchema, at(conversationId, id, 'view'), POST),
  stop: (conversationId: string, id: string): Promise<AgentTerminal> =>
    request(agentTerminalSchema, at(conversationId, id, 'stop'), POST),
};

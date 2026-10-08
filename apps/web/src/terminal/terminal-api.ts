import { z } from 'zod';
import {
  nativeTerminalSessionSchema,
  nativeTerminalLaunchResponseSchema,
  createShellResponseSchema,
  createTerminalResponseSchema,
  shellBusyResponseSchema,
  type CreateShellResponse,
  type CreateTerminalResponse,
  type ProviderId,
  type TerminalStep,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export interface TerminalTicket {
  id: string;
  token: string;
}

export function createTerminalSession(
  provider: ProviderId,
  step: TerminalStep,
): Promise<CreateTerminalResponse> {
  return request(createTerminalResponseSchema, '/terminal/sessions', {
    method: 'POST',
    body: JSON.stringify({ provider, step }),
  });
}

export function createShell(conversationId: string | null): Promise<CreateShellResponse> {
  return request(createShellResponseSchema, '/terminal/shells', {
    method: 'POST',
    body: JSON.stringify({ conversationId }),
  });
}

export async function runningCommand(sessionId: string): Promise<string | null> {
  const busy = await request(shellBusyResponseSchema, `/terminal/sessions/${sessionId}/busy`);
  return busy.command;
}

export function streamUrl(session: TerminalTicket, cols: number, rows: number): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const query = new URLSearchParams({
    token: session.token,
    cols: String(cols),
    rows: String(rows),
  });
  return `${protocol}://${window.location.host}/api/terminal/sessions/${session.id}/stream?${query}`;
}

export async function deleteTerminalSession(id: string): Promise<void> {
  const response = await fetch(`/api/terminal/sessions/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error('The terminal could not be stopped. Try again.');
}

export const nativeTerminalApi = {
  stop: (conversationId: string) =>
    request(z.null(), `/conversations/${conversationId}/terminal`, { method: 'DELETE' }),
  get: (conversationId: string) =>
    request(nativeTerminalSessionSchema.nullable(), `/conversations/${conversationId}/terminal`),
  launch: (
    conversationId: string,
    body: {
      provider?: 'claude' | 'codex';
      prompt?: string;
      messageId?: string;
      resume?: boolean;
    } = {},
  ) =>
    request(nativeTerminalLaunchResponseSchema, `/conversations/${conversationId}/terminal`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  attach: (id: string) =>
    request(createShellResponseSchema, `/terminal/sessions/${id}/attach`, {
      method: 'POST',
      body: '{}',
    }),
};

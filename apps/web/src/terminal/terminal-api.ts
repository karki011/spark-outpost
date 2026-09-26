import {
  createTerminalResponseSchema,
  type CreateTerminalResponse,
  type ProviderId,
  type TerminalStep,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export function createTerminalSession(
  provider: ProviderId,
  step: TerminalStep,
): Promise<CreateTerminalResponse> {
  return request(createTerminalResponseSchema, '/terminal/sessions', {
    method: 'POST',
    body: JSON.stringify({ provider, step }),
  });
}

export function streamUrl(session: CreateTerminalResponse, cols: number, rows: number): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const query = new URLSearchParams({
    token: session.token,
    cols: String(cols),
    rows: String(rows),
  });
  return `${protocol}://${window.location.host}/api/terminal/sessions/${session.id}/stream?${query}`;
}

export async function deleteTerminalSession(id: string): Promise<void> {
  await fetch(`/api/terminal/sessions/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
}

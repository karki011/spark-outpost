import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';

export interface StoredFakeSession {
  cwd: string;
  directories: string[] | null;
  prompts: string[];
  closes: number;
}

const store = process.env.FAKE_ACP_SESSION_STORE ?? null;

export const loadSessionAdvertised = process.env.FAKE_ACP_LOAD_SESSION === '1';

const fileOf = (sessionId: string) => join(store ?? '', `${sessionId}.json`);

export function newSessionId(): string {
  return store ? randomUUID() : 'fake-session';
}

export function readFakeSession(sessionId: string): StoredFakeSession {
  const file = fileOf(sessionId);
  if (!store || !existsSync(file)) throw acp.RequestError.resourceNotFound(sessionId);
  return JSON.parse(readFileSync(file, 'utf8')) as StoredFakeSession;
}

function write(sessionId: string, session: StoredFakeSession): void {
  if (!store) return;
  mkdirSync(store, { recursive: true });
  writeFileSync(fileOf(sessionId), JSON.stringify(session));
}

export function createFakeSession(
  sessionId: string,
  cwd: string,
  directories: string[] | null,
): void {
  write(sessionId, { cwd, directories, prompts: [], closes: 0 });
}

export function recordPrompt(sessionId: string, text: string): void {
  if (!store) return;
  const session = readFakeSession(sessionId);
  write(sessionId, { ...session, prompts: [...session.prompts, text] });
}

export function recordClose(sessionId: string): void {
  if (!store) return;
  const session = readFakeSession(sessionId);
  write(sessionId, { ...session, closes: session.closes + 1 });
}

export async function replayHistory(
  sessionId: string,
  session: StoredFakeSession,
  update: (sessionId: string, value: acp.SessionUpdate) => Promise<void>,
): Promise<void> {
  for (const [index, prompt] of session.prompts.entries()) {
    await update(sessionId, {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: prompt },
    });
    await update(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId: `replay-${index}`,
      title: 'Replayed tool',
      kind: 'read',
      status: 'completed',
    });
    await update(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: `replayed reply ${index}` },
    });
  }
}

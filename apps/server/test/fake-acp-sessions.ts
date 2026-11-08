import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk/unstable';

export interface StoredFakeSession {
  cwd: string;
  directories: string[] | null;
  prompts: string[];
  closes: number;
  used?: number;
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
  const partial = `${fileOf(sessionId)}.${process.pid}.tmp`;
  writeFileSync(partial, JSON.stringify(session));
  renameSync(partial, fileOf(sessionId));
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

export function recordMethod(method: string): void {
  const log = process.env.FAKE_ACP_METHOD_LOG;
  if (log) appendFileSync(log, `${process.pid} ${method}\n`);
}

export function recordCancel(sessionId: string): void {
  const log = process.env.FAKE_ACP_CANCEL_LOG;
  if (log) appendFileSync(log, `${sessionId}\n`);
}

export async function deleteFakeSession(sessionId: string): Promise<acp.DeleteSessionResponse> {
  recordMethod(`session/delete ${sessionId}`);
  if (process.env.FAKE_ACP_DELETE === 'hang') await new Promise(() => undefined);
  if (process.env.FAKE_ACP_DELETE === 'fail') throw acp.RequestError.internalError();
  return {};
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

const memoryContext = new Map<string, number>();

export function sessionContext(sessionId: string): number | null {
  if (!store) return memoryContext.get(sessionId) ?? null;
  return readFakeSession(sessionId).used ?? null;
}

export function recordContext(sessionId: string, used: number): void {
  if (!store) {
    memoryContext.set(sessionId, used);
    return;
  }
  write(sessionId, { ...readFakeSession(sessionId), used });
}

export function legacySession(config: Record<string, string>) {
  return {
    sessionId: 'fake-session',
    modes: {
      currentModeId: config.mode ?? '',
      availableModes: [
        { id: 'read-only', name: 'Ask first' },
        { id: 'agent', name: 'Agent' },
      ],
    },
    models: {
      currentModelId: config.model,
      availableModels: [
        { modelId: 'fast-1', name: 'Fast One' },
        { modelId: 'smart-2', name: 'Smart Two' },
      ],
    },
  };
}

export function listFakeSessions(cwd: string | null): acp.ListSessionsResponse {
  if (!store || !existsSync(store)) return { sessions: [] };
  const sessions = readdirSync(store)
    .filter((file) => file.endsWith('.json') && !file.endsWith('.config.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .map((sessionId) => ({ sessionId, cwd: readFakeSession(sessionId).cwd }))
    .filter((session) => cwd === null || session.cwd === cwd);
  return { sessions };
}

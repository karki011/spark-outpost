import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversation } from '../src/persistence/conversations.ts';
import { saveConnection } from '../src/persistence/setup.ts';
import type { RunInput } from '../src/workflow/run-input.ts';
import { prepareTurnSession } from '../src/workflow/turn-session.ts';
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;
const limits = { idleMs: 30 * 60_000, openLimit: 8 };

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t, { fixedRunProvider: null });
});

afterEach(async () => {
  await t.cleanup();
});

function chatInput(conversationId: string, previousMessageId: string | null): RunInput {
  return {
    identity: { runId: randomUUID(), threadId: conversationId },
    workspaceId: t.workspaceId,
    prompt: 'next',
    attachments: [],
    provider: 'claude',
    history: [],
    settings: { method: 'cli', model: 'sonnet', modelLabel: 'Sonnet', effort: 'medium' },
    projectRoots: [],
    mode: 'chat',
    level: 'balanced',
    parentRunId: null,
    userRequest: 'next',
    role: null,
    copyOf: null,
    askTitle: false,
    previousMessageId,
  };
}

const commands = [
  { name: 'compact', description: 'Summarize', hint: null },
  { name: 'logout', description: 'Sign out', hint: null },
  { name: 'review', description: 'Review', hint: 'what to review' },
];

describe('agent commands per session', () => {
  it('stores advertised commands, passes them to a resumed turn and lists the allowed ones', async () => {
    await saveConnection(t.db, t.workspaceId, 'claude', {
      method: 'cli',
      detail: 'claude 1.0',
      summary: '',
      models: [],
    });
    const id = (await createConversation(t.db, t.workspaceId, randomUUID())).id;
    const turn = await prepareTurnSession(t.db, chatInput(id, null), limits);
    if (!turn) throw new Error('The turn was not tracked.');
    await turn.started({
      kind: 'session',
      sessionId: 's-1',
      cwd: turn.target.workdir ?? '/work',
      additionalDirectories: [],
      continued: false,
      freshReason: null,
    });
    await turn.commands(commands);
    const messageId = randomUUID();
    await t.db.query(
      `INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, 'assistant', 'Hi')`,
      [messageId, id],
    );
    await turn.finished({ outcome: 'succeeded', messageId, text: 'Hi' });

    const next = await prepareTurnSession(t.db, chatInput(id, messageId), limits);
    expect(next?.target.resume?.commands).toEqual(['compact', 'logout', 'review']);

    const listed = await request(app)
      .get(`/api/conversations/${id}/agent-commands`)
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({
      provider: 'claude',
      commands: [commands[0], commands[2]],
    });
  });

  it('answers 404 for an unknown chat', async () => {
    const response = await request(app)
      .get(`/api/conversations/${randomUUID()}/agent-commands`)
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN);
    expect(response.status).toBe(404);
  });
});

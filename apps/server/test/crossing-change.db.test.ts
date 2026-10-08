import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crossingChange } from '../src/coordinator/crossing-change.ts';
import { editEvidence } from '../src/coordinator/edit-evidence.ts';
import { insertFinishedRunEntries } from '../src/persistence/audit-log.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { insertCommand } from '../src/persistence/run-commands.ts';
import { createTestDb, type TestDb } from './support.ts';

const TREE = '/work/chat-tree';

let t: TestDb;
let parent: { runId: string; conversationId: string; messageId: string };

beforeEach(async () => {
  t = await createTestDb();
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  const messageId = randomUUID();
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: messageId, content: 'Build the utilities.' },
    { provider: 'claude' },
  );
  parent = { runId: sent.run.id, conversationId: conversation.id, messageId };
});

afterEach(async () => {
  await t.cleanup();
});

async function pieceRun(pieceKey: string): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, parent_run_id,
       role, route)
     VALUES ($1, $2, $3, 'claude', 'succeeded', $4, 'builder', $5)`,
    [id, parent.conversationId, parent.messageId, parent.runId, { pieceKey }],
  );
  return id;
}

const ran = (runId: string, command: string, cwd: string | null) =>
  insertCommand(t.db, runId, {
    id: randomUUID(),
    command,
    cwd,
    live: false,
    startedAt: new Date().toISOString(),
    textOffset: null,
    textBefore: null,
    textHeld: null,
  });

async function edited(runId: string, toolCallId: string, diffs: object[], truncated = false) {
  const update = { sessionUpdate: 'tool_call_update', toolCallId, kind: 'edit', content: diffs };
  const payload = truncated
    ? { head: '{"method":"session/update"' }
    : { jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update } };
  await insertFinishedRunEntries(t.db, runId, [
    {
      at: new Date(),
      direction: 'from_agent',
      kind: 'notification',
      method: 'session/update',
      rpcId: null,
      sizeBytes: 10,
      truncated,
      payload,
    },
  ]);
}

const diff = (path: string, oldText: string | null, newText: string) => ({
  type: 'diff',
  path: `${TREE}/${path}`,
  oldText,
  newText,
});

const crossing = (runId: string) => ({ runId, cwd: TREE, before: 'a', after: null });

describe('whose command wrote a file', () => {
  it('reads a redirect from a command stored with the folder label Claude runs get', async () => {
    const p1 = await pieceRun('P1');
    await ran(p1, 'echo "// tiny-utils test" >> test/csv.test.ts', './');
    await ran(p1, `cd "${TREE}" && echo done >> src/csv.ts`, './');
    const evidence = await editEvidence(t.db, parent.runId, 'P1', TREE);
    expect([...evidence.mine].sort()).toEqual(['src/csv.ts', 'test/csv.test.ts']);
    const owner = await editEvidence(t.db, parent.runId, 'P2', TREE);
    expect([...owner.others].sort()).toEqual(['src/csv.ts', 'test/csv.test.ts']);
  });
});

describe('what a worker changed in a file another piece owns', () => {
  it('is the command that wrote it, not the file’s whole diff', async () => {
    const p1 = await pieceRun('P1');
    await ran(p1, 'node --test test/duration.test.ts', './');
    await ran(p1, 'echo "// tiny-utils test" >> test/csv.test.ts', './');
    expect(await crossingChange(t.db, crossing(p1), 'test/csv.test.ts')).toEqual({
      whole: false,
      patch: '$ echo "// tiny-utils test" >> test/csv.test.ts',
    });
  });

  it('is the worker’s own edits, once each, as the agent reported them', async () => {
    const p1 = await pieceRun('P1');
    const change = diff(
      'src/csv.ts',
      'export function parseCsv(',
      '// tiny-utils module\n\nexport function parseCsv(',
    );
    await edited(p1, 'call-1', [change]);
    await edited(p1, 'call-1', [change]);
    await edited(p1, 'call-2', [diff('src/duration.ts', 'a', 'b')]);
    expect(await crossingChange(t.db, crossing(p1), 'src/csv.ts')).toEqual({
      whole: false,
      patch: '-export function parseCsv(\n+// tiny-utils module\n+\n+export function parseCsv(',
    });
  });

  it('falls back to the file’s whole diff when the worker rewrote the file or the record is cut', async () => {
    const rewrote = await pieceRun('P1');
    await edited(rewrote, 'call-1', [
      diff('src/csv.ts', null, '// tiny-utils module\n\nwhole file'),
    ]);
    expect(await crossingChange(t.db, crossing(rewrote), 'src/csv.ts')).toEqual({
      whole: true,
      patch: '',
    });
    const cut = await pieceRun('P3');
    await edited(cut, 'call-1', [diff('src/csv.ts', 'a', 'b')]);
    await edited(cut, 'call-2', [], true);
    expect((await crossingChange(t.db, crossing(cut), 'src/csv.ts')).whole).toBe(true);
    const unseen = await pieceRun('P4');
    expect((await crossingChange(t.db, crossing(unseen), 'src/csv.ts')).whole).toBe(true);
  });
});

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGENT_TERMINAL_STORED_CHARS } from '@spark-outpost/contracts';
import {
  askAgentTerminalStop,
  endAgentTerminal,
  endLiveAgentTerminals,
  markAgentTerminalRunning,
  saveAgentTerminalOutput,
  stopChatAgentTerminals,
  stopRunAgentTerminals,
} from '../src/persistence/agent-terminal-changes.ts';
import {
  agentTerminalOutput,
  agentTerminalRow,
  chatAgentTerminals,
  liveAgentTerminals,
  startAgentTerminal,
  toAgentTerminal,
  type AgentTerminalRow,
  type NewAgentTerminal,
} from '../src/persistence/agent-terminals.ts';
import { deleteConversation } from '../src/persistence/conversation-actions.ts';
import { listen } from '../src/persistence/notifications.ts';
import { doRun, insertCommandApproval, sendDo, type LinkedRun } from './approval-support.ts';
import { createTestDb, eventually, testDatabaseUrl, type TestDb } from './support.ts';

interface ChangeEvent {
  kind: string;
  conversationId: string | null;
  runId: string | null;
}

let t: TestDb;
let base: string;
let chat: LinkedRun;
let seen: ChangeEvent[];
let listener: Awaited<ReturnType<typeof listen>>;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-agent-terminal-')));
  chat = await doRun(t, base);
  seen = [];
  listener = await listen(testDatabaseUrl(), 'changes', (payload) => {
    seen.push(JSON.parse(payload) as ChangeEvent);
  });
});

afterEach(async () => {
  await listener.close();
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

function asked(change: Partial<NewAgentTerminal> = {}): NewAgentTerminal {
  return {
    runId: chat.runId,
    toolCallId: 'call-1',
    name: 'pnpm dev',
    command: 'pnpm dev',
    cwd: base,
    decidedBy: 'mode',
    approvalId: null,
    textOffset: 12,
    textBefore: 'Starting it.',
    textHeld: 0,
    ...change,
  };
}

async function start(change: Partial<NewAgentTerminal> = {}): Promise<AgentTerminalRow> {
  return (await startAgentTerminal(t.db, asked(change)))!.row;
}

const row = async (id: string) => (await agentTerminalRow(t.db, id))!;

const notified = (match: (event: ChangeEvent) => boolean) =>
  eventually(async () => seen.some((event) => event.kind === 'agent_terminal' && match(event)));

const ended = (output = '') => ({ exitCode: 0, spawned: true, output, outputChars: output.length });

describe('starting an agent terminal', () => {
  it('creates a starting row for the run, its chat and its workspace', async () => {
    const created = await startAgentTerminal(t.db, asked());
    expect(created?.created).toBe(true);
    expect(created?.row).toMatchObject({
      workspaceId: t.workspaceId,
      conversationId: chat.conversationId,
      runId: chat.runId,
      provider: 'fake',
      command: 'pnpm dev',
      cwd: base,
      wanted: 'running',
      status: 'starting',
      decidedBy: 'mode',
      stoppedBy: null,
      pid: null,
      endedAt: null,
    });
    expect(toAgentTerminal(created!.row)).toMatchObject({
      state: 'starting',
      textOffset: 12,
      textBefore: 'Starting it.',
    });
  });

  it('returns the same row for a second start with the same tool call', async () => {
    const first = await startAgentTerminal(t.db, asked());
    const again = await startAgentTerminal(t.db, asked({ command: 'pnpm dev --host' }));
    expect(again).toEqual({ row: first!.row, created: false });
    expect(await chatAgentTerminals(t.db, chat.conversationId)).toHaveLength(1);
  });

  it('makes one row per tool call, and one per start without a tool call id', async () => {
    await start();
    await start({ toolCallId: 'call-2' });
    await start({ toolCallId: null });
    await start({ toolCallId: null });
    expect(await chatAgentTerminals(t.db, chat.conversationId)).toHaveLength(4);
  });

  it('starts nothing for a run that does not exist', async () => {
    const missing = '01990000-0000-7000-8000-0000000000ff';
    expect(await startAgentTerminal(t.db, asked({ runId: missing }))).toBeNull();
  });

  it('records the card that approved it', async () => {
    const card = await insertCommandApproval(t, chat.runId, base, 'pnpm dev');
    const started = await start({ decidedBy: 'card', approvalId: card.id });
    expect(started).toMatchObject({ decidedBy: 'card', approvalId: card.id });
  });
});

describe('state changes', () => {
  it('runs, saves its output tail and exits with a code', async () => {
    const { id } = await start();
    expect(await markAgentTerminalRunning(t.db, id, 4242)).toBe(true);
    expect(await row(id)).toMatchObject({ status: 'running', pid: 4242 });
    await saveAgentTerminalOutput(t.db, id, 'ready\n', 6);
    expect(await agentTerminalOutput(t.db, chat.conversationId, id)).toEqual({
      output: 'ready\n',
      outputChars: 6,
    });
    const done = await endAgentTerminal(t.db, id, { ...ended('ready\nbye\n'), exitCode: 3 });
    expect(done).toMatchObject({ status: 'exited', exitCode: 3, pid: null, stoppedBy: null });
    expect(done?.endedAt).toBeInstanceOf(Date);
  });

  it('keeps only the tail of a long output and counts all of it', async () => {
    const { id } = await start();
    const long = `${'x'.repeat(AGENT_TERMINAL_STORED_CHARS)}\ntail\n`;
    await saveAgentTerminalOutput(t.db, id, long, long.length);
    const saved = await agentTerminalOutput(t.db, chat.conversationId, id);
    expect(saved?.outputChars).toBe(long.length);
    expect(saved?.output.length).toBeLessThanOrEqual(AGENT_TERMINAL_STORED_CHARS);
    expect(saved?.output.endsWith('tail\n')).toBe(true);
  });

  it('does not let an older output save replace a newer one', async () => {
    const { id } = await start();
    await saveAgentTerminalOutput(t.db, id, 'one\ntwo\n', 8);
    await saveAgentTerminalOutput(t.db, id, 'one\n', 4);
    expect((await agentTerminalOutput(t.db, chat.conversationId, id))?.output).toBe('one\ntwo\n');
  });

  it('fails when the process could not start', async () => {
    const { id } = await start();
    const failed = await endAgentTerminal(t.db, id, {
      exitCode: null,
      spawned: false,
      output: 'no such folder',
      outputChars: 14,
    });
    expect(failed).toMatchObject({ status: 'failed', exitCode: null });
  });

  it('does not show another chat the output', async () => {
    const { id } = await start();
    const other = await doRun(t, base, 'other');
    expect(await agentTerminalOutput(t.db, other.conversationId, id)).toBeNull();
  });
});

describe('stopping', () => {
  it('asks for a stop, records who asked, and ends as stopped when the process exits', async () => {
    const { id } = await start();
    await markAgentTerminalRunning(t.db, id, 1);
    const asking = await askAgentTerminalStop(t.db, id, 'user');
    expect(asking).toMatchObject({ wanted: 'stopped', status: 'running', stoppedBy: 'user' });
    const done = await endAgentTerminal(t.db, id, { ...ended(), exitCode: null });
    expect(done).toMatchObject({ status: 'stopped', stoppedBy: 'user', pid: null });
  });

  it('keeps the first stopper when stop is asked twice', async () => {
    const { id } = await start();
    await askAgentTerminalStop(t.db, id, 'agent');
    expect(await askAgentTerminalStop(t.db, id, 'user')).toMatchObject({ stoppedBy: 'agent' });
  });

  it('leaves an ended terminal as it ended when a stop or a stale exit arrives', async () => {
    const { id } = await start();
    await markAgentTerminalRunning(t.db, id, 1);
    await askAgentTerminalStop(t.db, id, 'user');
    await endAgentTerminal(t.db, id, ended('first\n'));
    const stale = await endAgentTerminal(t.db, id, { ...ended('late\n'), exitCode: 9 });
    expect(stale).toMatchObject({ status: 'stopped', exitCode: 0 });
    expect(await askAgentTerminalStop(t.db, id, 'agent')).toMatchObject({ stoppedBy: 'user' });
    expect(await markAgentTerminalRunning(t.db, id, 2)).toBe(false);
    await saveAgentTerminalOutput(t.db, id, 'x'.repeat(50), 50);
    expect((await agentTerminalOutput(t.db, chat.conversationId, id))?.output).toBe('first\n');
  });

  it('answers null for a terminal that does not exist', async () => {
    const missing = '01990000-0000-7000-8000-0000000000ff';
    expect(await askAgentTerminalStop(t.db, missing, 'user')).toBeNull();
    expect(await endAgentTerminal(t.db, missing, ended())).toBeNull();
  });

  it('stops the terminals the stopped turn started and keeps earlier ones', async () => {
    const earlier = await start();
    await markAgentTerminalRunning(t.db, earlier.id, 1);
    const laterRun = await sendDo(t, chat.conversationId, 'again');
    const later = await start({ runId: laterRun });
    const finished = await start({ runId: laterRun, toolCallId: 'call-2' });
    await endAgentTerminal(t.db, finished.id, ended());

    const stopped = await stopRunAgentTerminals(t.db, laterRun);

    expect(stopped.map((terminal) => terminal.id)).toEqual([later.id]);
    expect(await row(later.id)).toMatchObject({ wanted: 'stopped', stoppedBy: 'turn_stopped' });
    expect(await row(earlier.id)).toMatchObject({ wanted: 'running', stoppedBy: null });
    expect(await row(finished.id)).toMatchObject({ status: 'exited', stoppedBy: null });
  });

  it('stops every live terminal of a chat that is being removed, and no other chat’s', async () => {
    const mine = await start();
    const other = await doRun(t, base, 'other');
    const theirs = await start({ runId: other.runId });

    const stopped = await stopChatAgentTerminals(t.db, chat.conversationId);

    expect(stopped.map((terminal) => terminal.id)).toEqual([mine.id]);
    expect(await row(mine.id)).toMatchObject({ wanted: 'stopped', stoppedBy: 'chat_removed' });
    expect(await row(theirs.id)).toMatchObject({ wanted: 'running' });
  });

  it('removes the rows with the chat', async () => {
    const { id } = await start();
    seen.length = 0;
    await deleteConversation(t.db, t.workspaceId, chat.conversationId);
    expect(await agentTerminalRow(t.db, id)).toBeNull();
    expect(await liveAgentTerminals(t.db, t.workspaceId)).toEqual([]);
    await notified((event) => event.conversationId === chat.conversationId);
  });

  it('keeps the terminal when only its run is deleted', async () => {
    const laterRun = await sendDo(t, chat.conversationId, 'again');
    const { id } = await start({ runId: laterRun });
    await t.db.query('DELETE FROM runs WHERE id = $1', [laterRun]);
    expect(await row(id)).toMatchObject({ runId: null, status: 'starting' });
  });
});

describe('when Spark goes away', () => {
  it('marks every live terminal interrupted at startup and starts nothing again', async () => {
    const starting = await start();
    const running = await start({ toolCallId: 'call-2' });
    await markAgentTerminalRunning(t.db, running.id, 77);
    const done = await start({ toolCallId: 'call-3' });
    await endAgentTerminal(t.db, done.id, ended());

    const gone = await endLiveAgentTerminals(t.db, t.workspaceId, 'startup');

    expect(gone.map((terminal) => terminal.id).sort()).toEqual([starting.id, running.id].sort());
    expect(await row(running.id)).toMatchObject({
      status: 'interrupted',
      wanted: 'stopped',
      pid: null,
      stoppedBy: null,
    });
    expect((await row(running.id)).endedAt).toBeInstanceOf(Date);
    expect(await row(done.id)).toMatchObject({ status: 'exited' });
    expect(await liveAgentTerminals(t.db, t.workspaceId)).toEqual([]);
    expect(await endLiveAgentTerminals(t.db, t.workspaceId, 'startup')).toEqual([]);
  });

  it('marks live terminals stopped by the quit, keeping an earlier stopper', async () => {
    const plain = await start();
    const asking = await start({ toolCallId: 'call-2' });
    await askAgentTerminalStop(t.db, asking.id, 'user');

    await endLiveAgentTerminals(t.db, t.workspaceId, 'quit');

    expect(await row(plain.id)).toMatchObject({ status: 'stopped', stoppedBy: 'quit' });
    expect(await row(asking.id)).toMatchObject({ status: 'stopped', stoppedBy: 'user' });
  });
});

describe('change notices', () => {
  const mine = (event: ChangeEvent) =>
    event.conversationId === chat.conversationId && event.runId === chat.runId;

  it('announces a start, a stop request and an end, but not an output save', async () => {
    const { id } = await start();
    await notified(mine);

    seen.length = 0;
    await saveAgentTerminalOutput(t.db, id, 'ready\n', 6);
    await markAgentTerminalRunning(t.db, id, 1);
    await notified(mine);
    expect(seen.filter((event) => event.kind === 'agent_terminal' && mine(event))).toHaveLength(1);

    seen.length = 0;
    await askAgentTerminalStop(t.db, id, 'agent');
    await notified(mine);

    seen.length = 0;
    await endAgentTerminal(t.db, id, ended());
    await notified(mine);
  });

  it('announces the startup sweep', async () => {
    await start();
    await notified(mine);
    seen.length = 0;
    await endLiveAgentTerminals(t.db, t.workspaceId, 'startup');
    await notified(mine);
  });
});

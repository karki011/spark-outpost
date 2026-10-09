import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTerminalState } from '@spark-outpost/contracts';
import { askAgentTerminalStop } from '../src/persistence/agent-terminal-changes.ts';
import {
  agentTerminalOutput,
  agentTerminalRow,
  startAgentTerminal,
  type AgentTerminalRow,
  type NewAgentTerminal,
} from '../src/persistence/agent-terminals.ts';
import { deleteConversation } from '../src/persistence/conversation-actions.ts';
import { AgentTerminals } from '../src/terminal/agent-terminals.ts';
import {
  FAST_AGENT_TERMINALS,
  fakeAgentTerminalRuntime,
  type FakeAgentTerminalRuntime,
} from './agent-terminal-support.ts';
import { doRun, type LinkedRun } from './approval-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let chat: LinkedRun;
let fake: FakeAgentTerminalRuntime;
let runner: AgentTerminals;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-agent-runner-')));
  chat = await doRun(t, base);
  fake = fakeAgentTerminalRuntime({ PATH: '/usr/bin', SPARK_API_TOKEN: 'launch', PORT: '4318' });
  runner = new AgentTerminals(t.db, t.workspaceId, fake.runtime, FAST_AGENT_TERMINALS);
});

afterEach(async () => {
  await runner.stopAll();
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

let calls = 0;

async function ask(change: Partial<NewAgentTerminal> = {}): Promise<AgentTerminalRow> {
  calls += 1;
  const started = await startAgentTerminal(t.db, {
    runId: chat.runId,
    toolCallId: `call-${calls}`,
    name: 'pnpm dev',
    command: 'pnpm dev',
    cwd: base,
    decidedBy: 'mode',
    approvalId: null,
    textOffset: null,
    textBefore: null,
    textHeld: null,
    ...change,
  });
  return started!.row;
}

async function started(change: Partial<NewAgentTerminal> = {}): Promise<AgentTerminalRow> {
  const row = await ask(change);
  await runner.sync();
  return row;
}

const row = async (id: string) => (await agentTerminalRow(t.db, id))!;
const saved = async (id: string) => (await agentTerminalOutput(t.db, chat.conversationId, id))!;

function becomes(id: string, state: AgentTerminalState): Promise<AgentTerminalRow> {
  return eventually(async () => {
    const current = await row(id);
    return current.status === state ? current : null;
  }, 5_000);
}

function viewer() {
  const seen = { output: '', ended: 0 };
  return {
    seen,
    output: (data: string) => {
      seen.output += data;
    },
    ended: () => {
      seen.ended += 1;
    },
  };
}

describe('starting', () => {
  it('runs the exact command in the row folder and marks the row running with its pid', async () => {
    const asked = await started({ command: 'pnpm dev --host' });
    expect(fake.spawned).toHaveLength(1);
    expect(fake.spawned[0]!.options).toMatchObject({ command: 'pnpm dev --host', cwd: base });
    expect(await row(asked.id)).toMatchObject({ status: 'running', pid: 4000, wanted: 'running' });
    expect(runner.runningCount).toBe(1);
  });

  it('gives the command none of the variables Spark runs with', async () => {
    await started();
    expect(fake.spawned[0]!.options.env).toEqual({
      PATH: '/usr/bin',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    });
  });

  it('spawns once when it is woken twice for the same row', async () => {
    const asked = await ask();
    await Promise.all([runner.sync(), runner.sync(), runner.sync()]);
    await runner.sync();
    expect(fake.spawned).toHaveLength(1);
    expect((await row(asked.id)).status).toBe('running');
  });

  it('runs as many as are asked for', async () => {
    for (let index = 0; index < 15; index += 1) await ask();
    await runner.sync();
    expect(fake.spawned).toHaveLength(15);
    expect(runner.runningCount).toBe(15);
  });

  it('ends the row as failed, with the reason, when the command cannot start', async () => {
    fake.spawnError = new Error('posix_spawnp failed');
    const asked = await started();
    expect(await row(asked.id)).toMatchObject({ status: 'failed', exitCode: null, pid: null });
    expect((await saved(asked.id)).output).toContain('posix_spawnp failed');
    expect(runner.runningCount).toBe(0);
  });

  it('ends the row as failed when its folder does not exist', async () => {
    fake.missingFolders.add(base);
    const asked = await started();
    expect((await row(asked.id)).status).toBe('failed');
    expect(fake.spawned).toHaveLength(0);
  });
});

describe('output', () => {
  it('saves the redacted tail while it runs and the total it printed', async () => {
    fake.secrets.push('hunter2-value-9');
    const asked = await started();
    fake.spawned[0]!.print('ready\ntoken hunter2-value-9\n');
    const output = await eventually(async () => {
      const current = await saved(asked.id);
      return current.outputChars > 0 ? current : null;
    });
    expect(output.output).toContain('ready\n');
    expect(output.output).not.toContain('hunter2-value-9');
    expect((await row(asked.id)).status).toBe('running');
  });

  it('shows a tab that opens later what was printed so far, then goes on live', async () => {
    const asked = await started();
    fake.spawned[0]!.print('first\r\n');
    const late = viewer();
    const view = runner.view(asked.id, late, { cols: 90, rows: 20 });
    expect(late.seen.output).toBe('first\r\n');
    expect(fake.spawned[0]!.size).toEqual({ cols: 90, rows: 20 });
    fake.spawned[0]!.print('second\r\n');
    expect(late.seen.output).toBe('first\r\nsecond\r\n');
    view!.detach();
    fake.spawned[0]!.print('third\r\n');
    expect(late.seen.output).toBe('first\r\nsecond\r\n');
  });

  it('sends nothing a viewer types to the process', async () => {
    const asked = await started();
    const view = runner.view(asked.id, viewer(), { cols: 80, rows: 24 })!;
    view.input('rm -rf .\r');
    expect(fake.spawned[0]!.written).toEqual([]);
  });

  it('has no view for a terminal that is not running', async () => {
    const asked = await started();
    fake.spawned[0]!.exit(0);
    await becomes(asked.id, 'exited');
    expect(runner.view(asked.id, viewer(), { cols: 80, rows: 24 })).toBeNull();
    expect(runner.running(asked.id)).toBe(false);
  });
});

describe('ending', () => {
  it('records the exit code and the last output, and tells the open tabs', async () => {
    const asked = await started();
    const tab = viewer();
    runner.view(asked.id, tab, { cols: 80, rows: 24 });
    fake.spawned[0]!.print('built\n');
    fake.spawned[0]!.exit(3);
    const ended = await becomes(asked.id, 'exited');
    expect(ended).toMatchObject({ exitCode: 3, pid: null, stoppedBy: null });
    expect(ended.endedAt).not.toBeNull();
    expect(await saved(asked.id)).toEqual({ output: 'built\n', outputChars: 6 });
    expect(tab.seen.ended).toBe(1);
    expect(runner.runningCount).toBe(0);
  });

  it('never starts a command again after it ended', async () => {
    const asked = await started();
    fake.spawned[0]!.exit(1);
    await becomes(asked.id, 'exited');
    await runner.sync();
    await runner.sync();
    expect(fake.spawned).toHaveLength(1);
  });

  it('kills the process when a stop is asked and records who asked', async () => {
    const asked = await started();
    fake.spawned[0]!.print('serving\n');
    await askAgentTerminalStop(t.db, asked.id, 'user');
    await runner.sync();
    expect(fake.spawned[0]!.killed).toBe(true);
    expect(await row(asked.id)).toMatchObject({
      status: 'stopped',
      stoppedBy: 'user',
      exitCode: null,
      pid: null,
    });
    expect((await saved(asked.id)).output).toBe('serving\n');
  });

  it('keeps the first stop when it is asked twice and woken twice', async () => {
    const asked = await started();
    await askAgentTerminalStop(t.db, asked.id, 'agent');
    await askAgentTerminalStop(t.db, asked.id, 'user');
    await Promise.all([runner.sync(), runner.sync()]);
    expect(await row(asked.id)).toMatchObject({ status: 'stopped', stoppedBy: 'agent' });
  });

  it('keeps stopped when the exit of the killed process arrives afterwards', async () => {
    const asked = await started();
    await askAgentTerminalStop(t.db, asked.id, 'user');
    await runner.sync();
    fake.spawned[0]!.exit(143);
    await runner.sync();
    expect(await row(asked.id)).toMatchObject({ status: 'stopped', exitCode: null });
  });

  it('ends as stopped when the process exits on its own just after a stop was asked', async () => {
    const asked = await started();
    await askAgentTerminalStop(t.db, asked.id, 'agent');
    fake.spawned[0]!.exit(0);
    await runner.sync();
    expect(await row(asked.id)).toMatchObject({ status: 'stopped', stoppedBy: 'agent' });
  });

  it('ends a row that was stopped before it was ever started, without spawning', async () => {
    const asked = await ask();
    await askAgentTerminalStop(t.db, asked.id, 'turn_stopped');
    await runner.sync();
    expect(fake.spawned).toHaveLength(0);
    expect(await row(asked.id)).toMatchObject({ status: 'stopped', stoppedBy: 'turn_stopped' });
  });

  it('kills the process of a row that is gone', async () => {
    const asked = await started();
    const tab = viewer();
    runner.view(asked.id, tab, { cols: 80, rows: 24 });
    await deleteConversation(t.db, t.workspaceId, chat.conversationId);
    await runner.sync();
    expect(fake.spawned[0]!.killed).toBe(true);
    expect(runner.runningCount).toBe(0);
    expect(tab.seen.ended).toBe(1);
    expect(await agentTerminalRow(t.db, asked.id)).toBeNull();
  });

  it('stops a terminal whose folder was removed', async () => {
    const asked = await started();
    fake.missingFolders.add(base);
    const ended = await becomes(asked.id, 'stopped');
    expect(ended.stoppedBy).toBe('folder_removed');
    expect(fake.spawned[0]!.killed).toBe(true);
  });
});

describe('startup and quit', () => {
  it('marks rows left live by an earlier process as interrupted and starts nothing', async () => {
    const running = await started();
    const waiting = await ask();
    const next = new AgentTerminals(t.db, t.workspaceId, fake.runtime, FAST_AGENT_TERMINALS);
    await next.recover();
    await next.sync();
    expect((await row(running.id)).status).toBe('interrupted');
    expect((await row(waiting.id)).status).toBe('interrupted');
    expect(fake.spawned).toHaveLength(1);
    expect(next.runningCount).toBe(0);
  });

  it('on quit kills every process, keeps its output and marks the rows stopped by quit', async () => {
    const first = await started();
    const second = await started();
    const waiting = await ask();
    fake.spawned[0]!.print('half a line');
    await runner.stopAll();
    expect(fake.spawned.map((process) => process.killed)).toEqual([true, true]);
    for (const id of [first.id, second.id, waiting.id]) {
      expect(await row(id)).toMatchObject({ status: 'stopped', stoppedBy: 'quit', pid: null });
    }
    expect((await saved(first.id)).output).toBe('half a line');
    expect(runner.runningCount).toBe(0);
  });
});

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
} from '../src/persistence/agent-terminals.ts';
import { deleteConversation } from '../src/persistence/conversation-actions.ts';
import { listen } from '../src/persistence/notifications.ts';
import { agentTerminalRuntime } from '../src/terminal/agent-terminal-process.ts';
import { AgentTerminals } from '../src/terminal/agent-terminals.ts';
import { isAlive } from '../src/terminal/process-group.ts';
import { FAST_AGENT_TERMINALS } from './agent-terminal-support.ts';
import { doRun, type LinkedRun } from './approval-support.ts';
import { createTestDb, eventually, testDatabaseUrl, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let chat: LinkedRun;
let runner: AgentTerminals;
let listener: Awaited<ReturnType<typeof listen>>;
let pids: number[];
let calls = 0;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-agent-real-')));
  chat = await doRun(t, base);
  pids = [];
  runner = new AgentTerminals(
    t.db,
    t.workspaceId,
    agentTerminalRuntime({ ...process.env, SPARK_LAUNCH_THING: 'not-for-commands' }, '/bin/sh'),
    FAST_AGENT_TERMINALS,
  );
  listener = await listen(testDatabaseUrl(), 'changes', (payload) => {
    const event = JSON.parse(payload) as { kind: string };
    if (event.kind === 'agent_terminal') void runner.sync().catch(() => undefined);
  });
});

afterEach(async () => {
  await listener.close();
  await runner.stopAll();
  await eventually(async () => pids.every((pid) => !isAlive(pid)), 10_000);
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

async function ask(command: string): Promise<AgentTerminalRow> {
  calls += 1;
  const started = await startAgentTerminal(t.db, {
    runId: chat.runId,
    toolCallId: `real-${calls}`,
    name: command.slice(0, 60),
    command,
    cwd: base,
    decidedBy: 'mode',
    approvalId: null,
    textOffset: null,
    textBefore: null,
    textHeld: null,
  });
  return started!.row;
}

function becomes(id: string, state: AgentTerminalState): Promise<AgentTerminalRow> {
  return eventually(async () => {
    const current = await agentTerminalRow(t.db, id);
    return current?.status === state ? current : null;
  }, 10_000);
}

const output = async (id: string) =>
  (await agentTerminalOutput(t.db, chat.conversationId, id))!.output;

async function runningWithChild(
  command: string,
): Promise<{ row: AgentTerminalRow; child: number }> {
  const asked = await ask(`${command} & echo "child=$!"; wait`);
  const row = await becomes(asked.id, 'running');
  const child = await eventually(async () => /child=(\d+)/.exec(await output(asked.id))?.[1]);
  pids.push(row.pid!, Number(child));
  return { row, child: Number(child) };
}

describe('a real command in an agent terminal', () => {
  it('starts when its row is announced, prints in its folder and ends with its exit code', async () => {
    const asked = await ask(`printf 'at %s [%s]\\n' "$PWD" "$SPARK_LAUNCH_THING"; exit 3`);
    const ended = await becomes(asked.id, 'exited');
    expect(ended).toMatchObject({ exitCode: 3, pid: null, stoppedBy: null });
    expect(await output(asked.id)).toContain(`at ${base} []`);
  });

  it('stops the whole process tree when a stop is asked while it runs', async () => {
    const { row, child } = await runningWithChild('sleep 300');
    expect(isAlive(row.pid!)).toBe(true);
    expect(isAlive(child)).toBe(true);

    await askAgentTerminalStop(t.db, row.id, 'user');
    expect(await becomes(row.id, 'stopped')).toMatchObject({ stoppedBy: 'user', pid: null });
    await eventually(async () => !isAlive(row.pid!) && !isAlive(child), 10_000);
  });

  it('kills the process when its row is deleted while it runs', async () => {
    const { row, child } = await runningWithChild('sleep 300');
    await deleteConversation(t.db, t.workspaceId, chat.conversationId);
    await eventually(async () => runner.runningCount === 0);
    await eventually(async () => !isAlive(row.pid!) && !isAlive(child), 10_000);
  });

  it('ends every running command when Spark quits', async () => {
    const first = await runningWithChild('sleep 300');
    const second = await runningWithChild('sleep 301');
    await runner.stopAll();
    for (const { row } of [first, second]) {
      expect(await becomes(row.id, 'stopped')).toMatchObject({ stoppedBy: 'quit' });
    }
    await eventually(
      async () => [first, second].every(({ row, child }) => !isAlive(row.pid!) && !isAlive(child)),
      10_000,
    );
  });
});

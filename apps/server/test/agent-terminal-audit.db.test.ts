import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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
import { listProtocolLog } from '../src/persistence/audit-log.ts';
import { TERMINAL_STOP_AUDIT } from '../src/workflow/terminal-audit.ts';
import { agentTerminalRuntime } from '../src/terminal/agent-terminal-process.ts';
import { AgentTerminals } from '../src/terminal/agent-terminals.ts';
import {
  FAST_AGENT_TERMINALS,
  fakeAgentTerminalRuntime,
  type FakeAgentTerminalRuntime,
} from './agent-terminal-support.ts';
import { doRun, type LinkedRun } from './approval-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const SECRET = 'rootSecretValue12345';

let t: TestDb;
let base: string;
let chat: LinkedRun;
let fake: FakeAgentTerminalRuntime;
let runner: AgentTerminals;
let calls = 0;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-agent-audit-')));
  chat = await doRun(t, base);
  fake = fakeAgentTerminalRuntime();
  runner = new AgentTerminals(t.db, t.workspaceId, fake.runtime, FAST_AGENT_TERMINALS);
});

afterEach(async () => {
  await runner.stopAll();
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

async function started(cwd = base, name = 'pnpm dev'): Promise<AgentTerminalRow> {
  calls += 1;
  const asked = await startAgentTerminal(t.db, {
    runId: chat.runId,
    toolCallId: `audit-${calls}`,
    name,
    command: 'pnpm dev',
    cwd,
    decidedBy: 'mode',
    approvalId: null,
    textOffset: null,
    textBefore: null,
    textHeld: null,
  });
  await runner.sync();
  return asked!.row;
}

function becomes(id: string, state: AgentTerminalState): Promise<AgentTerminalRow> {
  return eventually(async () => {
    const current = await agentTerminalRow(t.db, id);
    return current?.status === state ? current : null;
  }, 5_000);
}

async function stops() {
  const { entries } = await listProtocolLog(t.db, chat.runId, {
    after: 0,
    limit: 100,
    method: TERMINAL_STOP_AUDIT,
  });
  return entries.map((entry) => ({ direction: entry.direction, payload: entry.payload }));
}

describe('the audit entry for a stop the API process makes', () => {
  it('records a stop by the user once, with the terminal and who asked', async () => {
    const row = await started();
    await askAgentTerminalStop(t.db, row.id, 'user');
    await Promise.all([runner.sync(), runner.sync()]);
    await runner.sync();
    expect(await stops()).toEqual([
      {
        direction: 'harness',
        payload: {
          method: TERMINAL_STOP_AUDIT,
          params: { terminalId: row.id, name: 'pnpm dev', by: 'user' },
        },
      },
    ]);
  });

  it('records a stop because the folder was removed', async () => {
    const row = await started();
    fake.missingFolders.add(base);
    await becomes(row.id, 'stopped');
    const recorded = await eventually(async () => {
      const entries = await stops();
      return entries.length > 0 ? entries : null;
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.payload).toMatchObject({
      params: { terminalId: row.id, by: 'folder_removed' },
    });
  });

  it('records one entry per terminal stopped when Spark quits', async () => {
    const first = await started();
    const second = await started();
    await runner.stopAll();
    const recorded = await stops();
    expect(recorded.map((entry) => (entry.payload as { params: unknown }).params)).toEqual([
      { terminalId: first.id, name: 'pnpm dev', by: 'quit' },
      { terminalId: second.id, name: 'pnpm dev', by: 'quit' },
    ]);
    await runner.stopAll();
    expect(await stops()).toHaveLength(2);
  });

  it('leaves a stop by the agent or with the turn to the worker that asked for it', async () => {
    const byAgent = await started();
    const withTurn = await started();
    await askAgentTerminalStop(t.db, byAgent.id, 'agent');
    await askAgentTerminalStop(t.db, withTurn.id, 'turn_stopped');
    await runner.sync();
    expect((await agentTerminalRow(t.db, byAgent.id))!.status).toBe('stopped');
    expect(await stops()).toEqual([]);
  });

  it('records nothing for a command that ended on its own', async () => {
    const row = await started();
    fake.spawned[0]!.exit(0);
    await becomes(row.id, 'exited');
    expect(await stops()).toEqual([]);
  });

  it('never puts a secret-looking name in the entry', async () => {
    const row = await started(base, 'curl -H token=ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    await askAgentTerminalStop(t.db, row.id, 'user');
    await runner.sync();
    expect(JSON.stringify(await stops())).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });
});

describe('the saved output of a terminal started in a subfolder', () => {
  it('masks the values of the secret files in the chat’s project root', async () => {
    const inner = path.join(base, 'packages', 'app');
    await mkdir(inner, { recursive: true });
    await writeFile(path.join(base, '.env'), `API_TOKEN=${SECRET}\n`);
    runner = new AgentTerminals(
      t.db,
      t.workspaceId,
      { ...fake.runtime, secretValues: agentTerminalRuntime().secretValues },
      FAST_AGENT_TERMINALS,
    );
    const row = await started(inner);
    fake.spawned[0]!.print(`ready\ntoken ${SECRET}\n`);
    fake.spawned[0]!.exit(0);
    await becomes(row.id, 'exited');
    const saved = await agentTerminalOutput(t.db, chat.conversationId, row.id);
    expect(saved!.output).toContain('ready\n');
    expect(saved!.output).not.toContain(SECRET);
  });
});

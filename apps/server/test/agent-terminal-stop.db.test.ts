import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  endAgentTerminal,
  markAgentTerminalRunning,
  saveAgentTerminalOutput,
} from '../src/persistence/agent-terminal-changes.ts';
import type { AgentTerminalRow } from '../src/persistence/agent-terminals.ts';
import { requestCancel } from '../src/persistence/runs.ts';
import { NOT_THIS_CHATS } from '../src/spark-mcp/tools/terminal-run-tool.ts';
import { stopRun } from '../src/workflow/stop-run.ts';
import { TERMINAL_STOP_AUDIT } from '../src/workflow/terminal-audit.ts';
import { openBench, type Bench, type Turn } from './agent-terminal-tool-support.ts';
import { doRun, sendDo } from './approval-support.ts';

let b: Bench;

beforeEach(async () => {
  b = await openBench();
});

afterEach(async () => {
  await b.close();
});

describe('status, output and stop', () => {
  async function started(on: Turn, command = 'pnpm dev'): Promise<AgentTerminalRow> {
    const answer = await b.start(on, command);
    return (await b.rows(on.scope.conversationId!)).find((row) => row.id === answer.terminal?.id)!;
  }

  it('reports each terminal’s state as the runner records it', async () => {
    const on = await b.turn('bypassPermissions');
    const dev = await started(on);
    const watch = await started(on, 'pnpm test --watch');
    await markAgentTerminalRunning(b.t.db, dev.id, 4242);
    await endAgentTerminal(b.t.db, watch.id, {
      exitCode: 1,
      spawned: true,
      output: '',
      outputChars: 0,
    });
    const { answer } = await b.call(on, { action: 'status' });
    expect(answer.terminals).toEqual([
      expect.objectContaining({ id: watch.id, state: 'exited', exitCode: 1 }),
      expect.objectContaining({ id: dev.id, state: 'running', exitCode: null }),
    ]);
    expect(JSON.stringify(answer)).not.toContain('4242');
  });

  it('reads the saved tail as untrusted output', async () => {
    const on = await b.turn('bypassPermissions');
    const dev = await started(on);
    await markAgentTerminalRunning(b.t.db, dev.id, 4242);
    await saveAgentTerminalOutput(b.t.db, dev.id, 'one\ntwo\nready on 5173\n', 22);
    const read = await b.call(on, { action: 'output', id: dev.id, lines: 1 });
    expect(read.answer).toMatchObject({ action: 'output', lines: 1, outputChars: 22 });
    expect(read.texts[1]).toContain('ready on 5173');
    expect(read.texts[1]).not.toContain('two');
    expect(read.texts[1]).toContain('Untrusted program output');
  });

  it('stops this chat’s terminal as the agent, and leaves another chat’s alone', async () => {
    const on = await b.turn('bypassPermissions');
    const dev = await started(on);
    const other = await doRun(b.t, b.base, 'other');
    const elsewhere = await b.turn('bypassPermissions', {}, other);
    const theirs = await started(elsewhere);

    for (const action of ['stop', 'output']) {
      const refused = await b.call(on, { action, id: theirs.id });
      expect(refused.isError, action).toBe(true);
      expect(refused.texts.join(''), action).toBe(NOT_THIS_CHATS);
    }
    expect((await b.rows(other.conversationId))[0]).toMatchObject({ wanted: 'running' });
    expect((await b.call(on, { action: 'status' })).answer.terminals).toHaveLength(1);

    const { answer } = await b.call(on, { action: 'stop', id: dev.id });
    expect(answer.terminal).toMatchObject({ id: dev.id, stoppedBy: 'agent' });
    expect((await b.rows())[0]).toMatchObject({ wanted: 'stopped', stoppedBy: 'agent' });
    expect(on.audited.at(-1)).toMatchObject({
      message: { method: TERMINAL_STOP_AUDIT, params: { terminalId: dev.id, by: 'agent' } },
    });
  });

  it('lets a later turn of the chat check and stop a terminal an earlier turn started', async () => {
    const earlier = await b.turn('bypassPermissions');
    const dev = await started(earlier);
    const laterRun = await sendDo(b.t, b.chat.conversationId, 'stop the server');
    const later = await b.turn('bypassPermissions', {}, { ...b.chat, runId: laterRun });
    expect((await b.call(later, { action: 'status' })).answer.terminals).toHaveLength(1);
    const { answer } = await b.call(later, { action: 'stop', id: dev.id });
    expect(answer.terminal).toMatchObject({ stoppedBy: 'agent' });
    expect(later.audited).toHaveLength(1);
  });
});

describe('stopping the turn', () => {
  it('stops the terminals that turn started and keeps earlier ones running', async () => {
    const earlier = await b.turn('bypassPermissions');
    const kept = (await b.start(earlier)).terminal!;
    const laterRun = await sendDo(b.t, b.chat.conversationId, 'run the watcher');
    const later = await b.turn('bypassPermissions', {}, { ...b.chat, runId: laterRun });
    const first = (await b.start(later, 'pnpm test --watch')).terminal!;
    const second = (await b.start(later, 'pnpm lint --watch')).terminal!;

    await stopRun(b.t.db, laterRun);

    const after = new Map((await b.rows()).map((row) => [row.id, row]));
    expect(after.get(kept.id)).toMatchObject({ wanted: 'running', stoppedBy: null });
    expect(after.get(first.id)).toMatchObject({ wanted: 'stopped', stoppedBy: 'turn_stopped' });
    expect(after.get(second.id)).toMatchObject({ wanted: 'stopped', stoppedBy: 'turn_stopped' });
    expect(await b.stopEntries(laterRun)).toEqual([
      { terminalId: first.id, name: 'pnpm test --watch', by: 'turn_stopped' },
      { terminalId: second.id, name: 'pnpm lint --watch', by: 'turn_stopped' },
    ]);
    expect(await b.stopEntries(b.chat.runId)).toEqual([]);
  });

  it('stops a terminal a member of the stopped turn started', async () => {
    const memberRun = await sendDo(b.t, b.chat.conversationId, 'integrate');
    await b.t.db.query(`UPDATE runs SET parent_run_id = $1, role = 'integrator' WHERE id = $2`, [
      b.chat.runId,
      memberRun,
    ]);
    const member = await b.turn('bypassPermissions', {}, { ...b.chat, runId: memberRun });
    const terminal = (await b.start(member)).terminal!;
    await stopRun(b.t.db, b.chat.runId);
    expect((await b.rows())[0]).toMatchObject({ id: terminal.id, stoppedBy: 'turn_stopped' });
    expect(await b.stopEntries(memberRun)).toHaveLength(1);
  });

  it('keeps a terminal the agent already stopped as stopped by the agent', async () => {
    const on = await b.turn('bypassPermissions');
    const terminal = (await b.start(on)).terminal!;
    await b.call(on, { action: 'stop', id: terminal.id });
    await stopRun(b.t.db, b.chat.runId);
    expect((await b.rows())[0]).toMatchObject({ stoppedBy: 'agent' });
    expect(await b.stopEntries(b.chat.runId)).toEqual([]);
  });

  it('stops at once a terminal that starts after the stop was asked', async () => {
    const on = await b.turn('bypassPermissions');
    await requestCancel(b.t.db, b.chat.runId);
    const answer = await b.start(on);
    expect(answer.terminal).toMatchObject({ stoppedBy: 'turn_stopped' });
    expect((await b.rows())[0]).toMatchObject({ wanted: 'stopped', stoppedBy: 'turn_stopped' });
    expect(await b.stopEntries(b.chat.runId)).toHaveLength(1);
  });

  it('does nothing for a turn that started no terminal', async () => {
    await stopRun(b.t.db, b.chat.runId);
    expect(await b.rows()).toEqual([]);
    expect(await b.stopEntries(b.chat.runId)).toEqual([]);
  });
});

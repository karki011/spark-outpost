import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_TERMINAL_STARTED,
  APPROVAL_DECIDED,
  APPROVAL_REQUESTED,
} from '@spark-outpost/contracts';
import {
  NO_FOLDER_REASON,
  OUTSIDE_FOLDER_REASON,
  READ_ONLY_TURN_REASON,
  SECRET_COMMAND_REASON,
  SPARK_COMMAND_NOTE,
} from '../src/approvals/spark-command.ts';
import { endAgentTerminal } from '../src/persistence/agent-terminal-changes.ts';
import { expirePendingApprovals, getApproval } from '../src/persistence/approvals.ts';
import { CARD_CLOSED_REASON, NO_TURN_REASON } from '../src/spark-mcp/tools/terminal-run-start.ts';
import type { SparkCommandScope } from '../src/workflow/command-gate.ts';
import { TERMINAL_START_AUDIT } from '../src/workflow/terminal-audit.ts';
import { openBench, type Answer, type Bench } from './agent-terminal-tool-support.ts';
import { startSparkTools } from './spark-mcp-support.ts';

let b: Bench;

beforeEach(async () => {
  b = await openBench();
});

afterEach(async () => {
  await b.close();
});

describe('start in a mode that acts without asking', () => {
  it('starts at once, shows the row in the reply and marks the audit entry ran without review', async () => {
    const on = await b.turn('bypassPermissions');
    const answer = await b.start(on, 'pnpm dev', { name: 'Dev server', cwd: 'web' });
    const [row] = await b.rows();
    expect(answer).toEqual({
      action: 'start',
      terminal: expect.objectContaining({ id: row!.id, state: 'starting', name: 'Dev server' }),
    });
    expect(row).toMatchObject({
      runId: b.chat.runId,
      command: 'pnpm dev',
      cwd: path.join(b.base, 'web'),
      wanted: 'running',
      status: 'starting',
      decidedBy: 'mode',
      approvalId: null,
      textOffset: 26,
      textBefore: 'Starting the dev server.',
      textHeld: 2,
    });
    expect(await b.cards()).toEqual([]);
    expect(on.events.map(({ event }) => event)).toEqual([
      {
        type: 'CUSTOM',
        name: AGENT_TERMINAL_STARTED,
        value: {
          id: row!.id,
          name: 'Dev server',
          command: 'pnpm dev',
          cwd: path.join(b.base, 'web'),
          startedAt: row!.startedAt.toISOString(),
          textOffset: 26,
          textBefore: 'Starting the dev server.',
          textHeld: 2,
        },
      },
    ]);
    expect(on.audited).toEqual([
      {
        message: {
          method: TERMINAL_START_AUDIT,
          params: {
            command: 'pnpm dev',
            cwd: path.join(b.base, 'web'),
            mode: 'bypassPermissions',
            decision: 'mode',
            reason: null,
            unreviewed: true,
            terminalId: row!.id,
            approvalId: null,
          },
        },
        marks: { unreviewed: true },
      },
    ]);
  });

  it('follows the mode the session is in now, not the one the turn began with', async () => {
    const on = await b.turn('default');
    await b.t.db.query(`UPDATE runs SET used_mode = 'bypassPermissions' WHERE id = $1`, [
      b.chat.runId,
    ]);
    expect((await b.start(on)).terminal?.state).toBe('starting');
    expect(await b.cards()).toEqual([]);
  });

  it('still asks on a card for a hard rail, and starts nothing until it is allowed', async () => {
    const on = await b.turn('bypassPermissions');
    const asking = b.start(on, 'git config core.hooksPath hooks');
    const card = await b.pendingCard();
    expect(card.payload.command).toBe('git config core.hooksPath hooks');
    expect(await b.rows()).toEqual([]);
    await b.answerCard(on, 'reject_once');
    expect(await asking).toMatchObject({ refused: true });
    expect(await b.rows()).toEqual([]);
  });
});

describe('start in a mode that asks', () => {
  it('raises an ordinary card and starts only after Allow once', async () => {
    const on = await b.turn('default');
    const asking = b.start(on);
    const card = await b.pendingCard();
    expect(card).toMatchObject({
      kind: 'execute',
      status: 'pending',
      payload: { command: 'pnpm dev', cwd: b.base, asksBecause: SPARK_COMMAND_NOTE },
    });
    expect(card.options.map((option) => option.name)).toEqual(['Allow once', 'Reject']);
    expect(await b.rows()).toEqual([]);
    expect(on.events[0]).toMatchObject({
      event: { name: APPROVAL_REQUESTED },
      options: { transition: { status: 'awaiting_approval' } },
    });

    await b.answerCard(on, 'allow_once');
    const answer = await asking;
    const [row] = await b.rows();
    expect(answer.terminal).toMatchObject({ id: row!.id, state: 'starting' });
    expect(row).toMatchObject({ decidedBy: 'card', approvalId: card.id, status: 'starting' });
    expect(b.names(on)).toEqual([APPROVAL_REQUESTED, APPROVAL_DECIDED, AGENT_TERMINAL_STARTED]);
    expect(on.events[1]?.options).toEqual({ transition: { status: 'running' } });
    expect(on.audited).toHaveLength(1);
    expect(on.audited[0]).toMatchObject({
      message: {
        method: TERMINAL_START_AUDIT,
        params: { decision: 'card', approvalId: card.id, terminalId: row!.id, unreviewed: false },
      },
    });
    expect(on.audited[0]?.marks).toBeUndefined();
  });

  it('starts nothing on Reject and says why in one line', async () => {
    const on = await b.turn('default');
    const asking = b.start(on);
    const card = await b.answerCard(on, 'reject_once');
    expect(await asking).toEqual({
      action: 'start',
      refused: true,
      reason: expect.stringMatching(/^Denied: .*you denied it/),
    });
    expect(await b.rows()).toEqual([]);
    expect(b.names(on)).toEqual([APPROVAL_REQUESTED, APPROVAL_DECIDED]);
    expect(on.audited).toEqual([
      {
        message: {
          method: TERMINAL_START_AUDIT,
          params: expect.objectContaining({
            decision: 'refused',
            approvalId: card.id,
            terminalId: null,
            unreviewed: false,
          }),
        },
        marks: undefined,
      },
    ]);
  });

  it('asks in Accept edits even when the message asked, and for a push Full auto covers', async () => {
    const on = await b.turn('acceptEdits', {
      publish: { level: 'full-auto', requested: true, followUp: null },
    });
    const asking = b.start(on, 'pnpm dev');
    await b.pendingCard();
    await b.answerCard(on, 'reject_once');
    await asking;
    expect(await b.rows()).toEqual([]);
  });

  it('starts nothing when the card times out, and stops the turn as the gate does', async () => {
    const on = await b.turn('default', {}, b.chat, 60);
    const answer = await b.start(on);
    expect(answer).toMatchObject({ refused: true });
    expect(on.timedOut()).toBe(1);
    expect((await b.cards())[0]).toMatchObject({ status: 'expired', decidedBy: 'timeout' });
    expect(await b.rows()).toEqual([]);
  });

  it('starts nothing when the turn is stopped while the card waits', async () => {
    const on = await b.turn('default');
    const asking = b.start(on);
    const card = await b.pendingCard();
    on.stop();
    expect(await asking).toMatchObject({
      refused: true,
      reason: expect.stringContaining('stopped'),
    });
    expect(await getApproval(b.t.db, card.id)).toMatchObject({
      status: 'cancelled',
      decidedBy: 'stop',
    });
    expect(await b.rows()).toEqual([]);
  });

  it('starts nothing when Spark restarts while the card waits', async () => {
    const on = await b.turn('default');
    const asking = b.start(on);
    const card = await b.pendingCard();
    expect(await expirePendingApprovals(b.t.db, b.chat.runId, 'recovery')).toBe(1);
    on.waiters.notify(card.id);
    expect(await asking).toEqual({ action: 'start', refused: true, reason: CARD_CLOSED_REASON });
    expect(await b.rows()).toEqual([]);
    expect(await getApproval(b.t.db, card.id)).toMatchObject({ status: 'expired' });
  });

  it('refuses in Claude dontAsk, which skips anything not pre-approved', async () => {
    const on = await b.turn('dontAsk');
    expect(await b.start(on)).toMatchObject({ refused: true });
    expect(await b.cards()).toEqual([]);
    expect(await b.rows()).toEqual([]);
  });
});

describe('start: refusals', () => {
  it('refuses each case with its reason, no card and no terminal', async () => {
    const cases: [string, Partial<SparkCommandScope>, string, Record<string, unknown>][] = [
      [NO_FOLDER_REASON, { roots: [] }, 'pnpm dev', {}],
      [READ_ONLY_TURN_REASON, { runMode: 'ask' }, 'pnpm dev', {}],
      [READ_ONLY_TURN_REASON, { readOnly: true }, 'pnpm dev', {}],
      [OUTSIDE_FOLDER_REASON, {}, 'pnpm dev', { cwd: tmpdir() }],
      [SECRET_COMMAND_REASON, {}, 'API_KEY=sk-ant-abc123def456ghi789jkl012mno pnpm dev', {}],
    ];
    for (const [reason, change, command, extra] of cases) {
      const on = await b.turn('bypassPermissions', change);
      expect(await b.start(on, command, extra), reason).toEqual({
        action: 'start',
        refused: true,
        reason,
      });
      expect(on.audited.at(-1)?.message, reason).toMatchObject({
        method: TERMINAL_START_AUDIT,
        params: { decision: 'refused', reason, terminalId: null },
      });
      expect(on.audited.at(-1)?.marks).toBeUndefined();
      expect(on.events).toEqual([]);
    }
    expect(await b.cards()).toEqual([]);
    expect(await b.rows()).toEqual([]);
  });

  it('refuses a force push and a push of another branch in full access', async () => {
    const on = await b.turn('bypassPermissions');
    for (const command of ['git push --force origin main', 'git push origin main']) {
      expect(await b.start(on, command), command).toMatchObject({ refused: true });
    }
    expect(await b.rows()).toEqual([]);
  });

  it('refuses a Terminal session, which has no turn', async () => {
    const on = await b.turn('bypassPermissions');
    const scope = { ...on.scope };
    delete scope.commands;
    const answer = await b.start({ ...on, scope });
    expect(answer).toEqual({ action: 'start', refused: true, reason: NO_TURN_REASON });
    expect(await b.rows()).toEqual([]);
  });
});

describe('a duplicate start', () => {
  it('returns the same terminal for the same tool call, with one row, event and audit entry', async () => {
    const on = await b.turn('bypassPermissions');
    const first = await b.start(on, 'pnpm dev', {}, '7');
    const again = await b.start(on, 'pnpm dev', {}, '7');
    expect(again.terminal?.id).toBe(first.terminal?.id);
    expect(await b.rows()).toHaveLength(1);
    expect(b.names(on)).toEqual([AGENT_TERMINAL_STARTED]);
    expect(on.audited).toHaveLength(1);
  });

  it('does not ask again once the first call was allowed on a card', async () => {
    const on = await b.turn('default');
    const asking = b.start(on, 'pnpm dev', {}, '7');
    await b.answerCard(on, 'allow_once');
    const first = await asking;
    const again = await b.start(on, 'pnpm dev', {}, '7');
    expect(again.terminal?.id).toBe(first.terminal?.id);
    expect(await b.cards()).toHaveLength(1);
  });

  it('starts again when the same call arrives after its terminal ended', async () => {
    const on = await b.turn('bypassPermissions');
    const first = await b.start(on, 'pnpm dev', {}, '7');
    await endAgentTerminal(b.t.db, first.terminal!.id, {
      exitCode: 1,
      spawned: true,
      output: '',
      outputChars: 0,
    });
    const again = await b.start(on, 'pnpm dev', {}, '7');
    expect(again.terminal?.id).not.toBe(first.terminal?.id);
    expect(again.terminal?.state).toBe('starting');
    expect(await b.rows()).toHaveLength(2);
  });

  it('keeps apart two commands whose calls happen to share an id, and calls with no id', async () => {
    const on = await b.turn('bypassPermissions');
    await b.start(on, 'pnpm dev', {}, '7');
    await b.start(on, 'pnpm test --watch', {}, '7');
    await b.start(on, 'pnpm dev');
    await b.start(on, 'pnpm dev');
    expect(await b.rows()).toHaveLength(4);
  });

  it('takes the call id from the request when the agent calls over MCP', async () => {
    const on = await b.turn('bypassPermissions');
    const harness = await startSparkTools(b.t, on.scope);
    try {
      const called = await harness.call('spark_terminal_run', {
        action: 'start',
        command: 'pnpm dev',
      });
      expect(called.json<Answer>().terminal?.state).toBe('starting');
      const [row] = await b.rows();
      expect(row?.toolCallId).toMatch(/^spark_terminal_run:\d+:[0-9a-f]{16}$/);
    } finally {
      await harness.close();
    }
  });
});

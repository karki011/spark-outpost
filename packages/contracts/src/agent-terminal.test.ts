import { describe, expect, it } from 'vitest';
import { parseAppEvent } from './app-events.ts';
import {
  AGENT_TERMINAL_CHANGE,
  AGENT_TERMINAL_NAME_MAX,
  agentTerminalBrief,
  agentTerminalChangeSchema,
  agentTerminalEndState,
  agentTerminalInputSchema,
  agentTerminalLive,
  agentTerminalMoves,
  agentTerminalName,
  agentTerminalOutputTail,
  agentTerminalResultSchema,
  agentTerminalSchema,
  agentTerminalsRunningLine,
  agentTerminalStartedSchema,
  agentTerminalStateSchema,
  agentTerminalStateText,
  type AgentTerminal,
} from './agent-terminal.ts';

const ID = '01990000-0000-7000-8000-000000000001';
const CHAT = '01990000-0000-7000-8000-0000000000c1';
const RUN = '01990000-0000-7000-8000-0000000000aa';

const terminal = (change: Partial<AgentTerminal> = {}): AgentTerminal => ({
  id: ID,
  conversationId: CHAT,
  runId: RUN,
  provider: 'claude',
  name: 'pnpm dev',
  command: 'pnpm dev',
  cwd: '/Users/me/widgets',
  state: 'running',
  exitCode: null,
  decidedBy: 'mode',
  stoppedBy: null,
  outputChars: 0,
  startedAt: '2026-10-09T10:00:00.000Z',
  endedAt: null,
  textOffset: null,
  textBefore: null,
  textHeld: null,
  ...change,
});

describe('the agent terminal row', () => {
  it('accepts a running terminal and one whose run was deleted', () => {
    expect(agentTerminalSchema.parse(terminal())).toEqual(terminal());
    expect(agentTerminalSchema.parse(terminal({ runId: null })).runId).toBeNull();
  });

  it('refuses an unknown state, an unknown stopper and a long name', () => {
    expect(agentTerminalSchema.safeParse({ ...terminal(), state: 'paused' }).success).toBe(false);
    expect(agentTerminalSchema.safeParse({ ...terminal(), stoppedBy: 'phone' }).success).toBe(
      false,
    );
    const long = 'x'.repeat(AGENT_TERMINAL_NAME_MAX + 1);
    expect(agentTerminalSchema.safeParse({ ...terminal(), name: long }).success).toBe(false);
  });

  it('gives the agent a brief without the chat, the run or the reply anchor', () => {
    expect(Object.keys(agentTerminalBrief(terminal())).sort()).toEqual(
      [
        'id',
        'name',
        'command',
        'cwd',
        'state',
        'exitCode',
        'stoppedBy',
        'startedAt',
        'endedAt',
      ].sort(),
    );
  });
});

describe('the tool input', () => {
  it('reads each of the four actions', () => {
    expect(agentTerminalInputSchema.parse({ action: 'start', command: ' pnpm dev ' })).toEqual({
      action: 'start',
      command: 'pnpm dev',
    });
    expect(agentTerminalInputSchema.parse({ action: 'status' })).toEqual({ action: 'status' });
    expect(agentTerminalInputSchema.parse({ action: 'output', id: ID, lines: 50 })).toEqual({
      action: 'output',
      id: ID,
      lines: 50,
    });
    expect(agentTerminalInputSchema.parse({ action: 'stop', id: ID })).toEqual({
      action: 'stop',
      id: ID,
    });
  });

  it('has no action that sends input', () => {
    expect(agentTerminalInputSchema.safeParse({ action: 'input', id: ID, text: 'y' }).success).toBe(
      false,
    );
    expect(agentTerminalInputSchema.safeParse({ action: 'write', id: ID }).success).toBe(false);
  });

  it('refuses an empty command, too many lines and a stop without an id', () => {
    expect(agentTerminalInputSchema.safeParse({ action: 'start', command: '  ' }).success).toBe(
      false,
    );
    expect(
      agentTerminalInputSchema.safeParse({ action: 'output', id: ID, lines: 201 }).success,
    ).toBe(false);
    expect(agentTerminalInputSchema.safeParse({ action: 'stop' }).success).toBe(false);
  });
});

describe('the tool result', () => {
  it('marks output as untrusted', () => {
    const brief = agentTerminalBrief(terminal());
    const result = {
      action: 'output',
      terminal: brief,
      output: 'ready\n',
      lines: 1,
      outputChars: 6,
    };
    expect(agentTerminalResultSchema.safeParse(result).success).toBe(false);
    expect(agentTerminalResultSchema.safeParse({ ...result, untrusted: true }).success).toBe(true);
  });

  it('lists terminals for status and returns one for start and stop', () => {
    const brief = agentTerminalBrief(terminal());
    expect(agentTerminalResultSchema.parse({ action: 'status', terminals: [brief] })).toEqual({
      action: 'status',
      terminals: [brief],
    });
    expect(agentTerminalResultSchema.safeParse({ action: 'start', terminal: brief }).success).toBe(
      true,
    );
    expect(agentTerminalResultSchema.safeParse({ action: 'stop', terminal: brief }).success).toBe(
      true,
    );
  });
});

describe('events', () => {
  it('anchors the started event in the reply like a command', () => {
    const started = {
      id: ID,
      name: 'pnpm dev',
      command: 'pnpm dev',
      cwd: '/Users/me/widgets',
      startedAt: '2026-10-09T10:00:00.000Z',
      textOffset: 12,
      textBefore: 'Starting it.',
      textHeld: 0,
    };
    expect(agentTerminalStartedSchema.parse(started)).toEqual(started);
  });

  it('is an app event the change feed passes on', () => {
    const raw = JSON.stringify({ kind: AGENT_TERMINAL_CHANGE, conversationId: CHAT, runId: RUN });
    const event = parseAppEvent(raw);
    expect(event).toEqual({ kind: 'agent_terminal', conversationId: CHAT, runId: RUN });
    expect(agentTerminalChangeSchema.parse(event)).toEqual(event);
    expect(agentTerminalChangeSchema.safeParse({ ...event, kind: 'preview' }).success).toBe(false);
  });
});

describe('state', () => {
  it('counts starting and running as live', () => {
    const live = agentTerminalStateSchema.options.filter(agentTerminalLive);
    expect(live).toEqual(['starting', 'running']);
  });

  it('moves only forward, and never out of an ended state', () => {
    expect(agentTerminalMoves('starting', 'running')).toBe(true);
    expect(agentTerminalMoves('starting', 'failed')).toBe(true);
    expect(agentTerminalMoves('running', 'exited')).toBe(true);
    expect(agentTerminalMoves('running', 'stopped')).toBe(true);
    expect(agentTerminalMoves('running', 'interrupted')).toBe(true);
    expect(agentTerminalMoves('running', 'starting')).toBe(false);
    expect(agentTerminalMoves('running', 'running')).toBe(false);
    for (const ended of ['exited', 'stopped', 'failed', 'interrupted'] as const) {
      for (const next of agentTerminalStateSchema.options) {
        expect(agentTerminalMoves(ended, next)).toBe(false);
      }
    }
  });

  it('ends as stopped when a stop was asked, even if the process exited by itself', () => {
    expect(agentTerminalEndState({ wanted: 'stopped', exitCode: 0, spawned: true })).toBe(
      'stopped',
    );
    expect(agentTerminalEndState({ wanted: 'running', exitCode: 1, spawned: true })).toBe('exited');
    expect(agentTerminalEndState({ wanted: 'running', exitCode: null, spawned: false })).toBe(
      'failed',
    );
  });
});

describe('words', () => {
  it('names a terminal after its command on one line', () => {
    expect(agentTerminalName('pnpm  dev\n')).toBe('pnpm dev');
    const long = agentTerminalName(`vitest ${'x'.repeat(80)}`);
    expect(long).toHaveLength(AGENT_TERMINAL_NAME_MAX);
    expect(long.endsWith('…')).toBe(true);
  });

  it('says how it ended', () => {
    expect(agentTerminalStateText(terminal())).toBe('running');
    expect(agentTerminalStateText(terminal({ state: 'exited', exitCode: 0 }))).toBe('exit 0');
    expect(agentTerminalStateText(terminal({ state: 'exited', exitCode: null }))).toBe('ended');
    expect(agentTerminalStateText(terminal({ state: 'stopped', stoppedBy: 'user' }))).toBe(
      'stopped by you',
    );
    expect(agentTerminalStateText(terminal({ state: 'stopped', stoppedBy: 'agent' }))).toBe(
      'stopped by the agent',
    );
    expect(agentTerminalStateText(terminal({ state: 'stopped', stoppedBy: 'quit' }))).toBe(
      'stopped when Spark quit',
    );
    expect(agentTerminalStateText(terminal({ state: 'interrupted' }))).toBe(
      'stopped when Spark quit',
    );
    expect(agentTerminalStateText(terminal({ state: 'failed' }))).toBe('could not start');
  });

  it('counts what still runs for the end of a reply', () => {
    expect(agentTerminalsRunningLine([])).toBeNull();
    expect(agentTerminalsRunningLine([terminal({ state: 'exited' })])).toBeNull();
    expect(agentTerminalsRunningLine([terminal(), terminal({ state: 'stopped' })])).toBe(
      '1 agent terminal still running',
    );
    expect(agentTerminalsRunningLine([terminal(), terminal({ state: 'starting' })])).toBe(
      '2 agent terminals still running',
    );
  });

  it('keeps the last lines of the output', () => {
    expect(agentTerminalOutputTail('a\nb\nc\n', 2)).toBe('b\nc\n');
    expect(agentTerminalOutputTail('a\nb\nc', 2)).toBe('b\nc');
    expect(agentTerminalOutputTail('a\n', 5)).toBe('a\n');
    expect(agentTerminalOutputTail('', 5)).toBe('');
  });
});

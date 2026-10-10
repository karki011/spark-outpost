import { describe, expect, it } from 'vitest';
import { AGENT_TERMINAL_STARTED, type AgentTerminal } from '@spark-outpost/contracts';
import { mergeInvalidations } from '../../app/live/app-event-keys.ts';
import {
  agentTerminalFixture,
  FIXTURE_CHAT,
  FIXTURE_RUN,
  FIXTURE_TERMINAL,
} from '../../terminal/dock/agent-terminal-fixture.ts';
import {
  agentTerminalMark,
  agentTerminalRowState,
  agentTerminalSpoken,
  applyAgentTerminalEvent,
  turnAgentTerminals,
} from './agent-terminal-model.ts';
import { turnParts } from './reply-parts.ts';

const CHAT = FIXTURE_CHAT;
const RUN = FIXTURE_RUN;
const OTHER_RUN = '01990000-0000-7000-8000-0000000000ab';
const ID = FIXTURE_TERMINAL;
const STARTED_AT = '2026-10-09T10:00:00.000Z';
const terminal = agentTerminalFixture;

const started = {
  id: ID,
  name: 'pnpm dev',
  command: 'pnpm dev',
  cwd: '/work/widgets',
  startedAt: STARTED_AT,
  textOffset: 5,
  textBefore: 'Okay.',
  textHeld: 0,
};

describe('the run event for a terminal Spark starts', () => {
  it('adds the terminal once and ignores other events and bad payloads', () => {
    const event = { name: AGENT_TERMINAL_STARTED, value: started };
    const once = applyAgentTerminalEvent([], event);
    expect(once).toEqual([started]);
    expect(applyAgentTerminalEvent(once, event)).toBe(once);
    expect(applyAgentTerminalEvent(once, { name: 'command_started', value: started })).toBe(once);
    expect(
      applyAgentTerminalEvent([], { name: AGENT_TERMINAL_STARTED, value: { id: 'x' } }),
    ).toEqual([]);
  });
});

describe('the terminals of one turn', () => {
  it('shows a streamed terminal as starting until the saved row arrives', () => {
    expect(turnAgentTerminals(undefined, [started], [RUN], RUN)).toMatchObject([
      { id: ID, runId: RUN, state: 'starting', textOffset: 5 },
    ]);
    const saved = [terminal({ state: 'running' })];
    expect(turnAgentTerminals(saved, [started], [RUN], RUN).map((item) => item.state)).toEqual([
      'running',
    ]);
  });

  it('keeps only the terminals this turn started', () => {
    const saved = [terminal(), terminal({ id: OTHER_RUN, runId: OTHER_RUN })];
    expect(turnAgentTerminals(saved, [], [RUN, undefined], RUN).map((item) => item.id)).toEqual([
      ID,
    ]);
    expect(turnAgentTerminals(saved, [started], [OTHER_RUN], OTHER_RUN)).toHaveLength(1);
  });

  it('sits in the reply where the agent asked for it', () => {
    const parts = turnParts('Okay. Started it.', [], [], [terminal({ ...started })]);
    expect(parts.map((part) => part.kind)).toEqual(['text', 'terminal', 'text']);
    expect(turnParts('Done.', [], [], [terminal()]).map((part) => part.kind)).toEqual([
      'text',
      'terminal',
    ]);
  });
});

describe('what the row says', () => {
  const now = Date.parse(STARTED_AT) + 75_000;
  const ended = { endedAt: '2026-10-09T10:00:09.000Z' };

  it('gives the state and how long it has run or ran', () => {
    expect(agentTerminalRowState(terminal({ state: 'starting' }), now)).toBe('starting');
    expect(agentTerminalRowState(terminal(), now)).toBe('running · 1m 15s');
    expect(agentTerminalRowState(terminal({ state: 'exited', exitCode: 0, ...ended }), now)).toBe(
      'exit 0 · 9s',
    );
    expect(agentTerminalRowState(terminal({ state: 'failed', ...ended }), now)).toBe(
      'could not start',
    );
  });

  it('says who stopped it', () => {
    const stopped = (stoppedBy: AgentTerminal['stoppedBy']) =>
      agentTerminalRowState(terminal({ state: 'stopped', stoppedBy, ...ended }), now);
    expect(stopped('user')).toBe('stopped by you · 9s');
    expect(stopped('agent')).toBe('stopped by the agent · 9s');
    expect(stopped('turn_stopped')).toBe('stopped with the turn · 9s');
    expect(agentTerminalRowState(terminal({ state: 'interrupted', ...ended }), now)).toBe(
      'stopped when Spark quit · 9s',
    );
  });

  it('marks a clean exit apart from every other ending', () => {
    expect(agentTerminalMark(terminal())).toBe('live');
    expect(agentTerminalMark(terminal({ state: 'exited', exitCode: 0 }))).toBe('ok');
    expect(agentTerminalMark(terminal({ state: 'exited', exitCode: 2 }))).toBe('ended');
    expect(agentTerminalMark(terminal({ state: 'stopped', stoppedBy: 'user' }))).toBe('ended');
  });

  it('has words for a screen reader', () => {
    expect(agentTerminalSpoken(terminal())).toBe('Agent terminal running pnpm dev');
    expect(agentTerminalSpoken(terminal({ state: 'stopped', stoppedBy: 'user' }))).toBe(
      'Agent terminal stopped by you: pnpm dev',
    );
  });
});

describe('the agent_terminal app event', () => {
  it('refreshes that chat’s terminal list and nothing else', () => {
    expect(
      mergeInvalidations([{ kind: 'agent_terminal', conversationId: CHAT, runId: RUN }]),
    ).toEqual([{ queryKey: ['agent-terminals', 'chat', CHAT], exact: true }]);
    expect(
      mergeInvalidations([{ kind: 'agent_terminal', conversationId: null, runId: null }]),
    ).toEqual([{ queryKey: ['agent-terminals'] }]);
  });
});

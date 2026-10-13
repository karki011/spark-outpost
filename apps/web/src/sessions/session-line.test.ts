import { describe, expect, it } from 'vitest';
import type {
  ConversationSummary,
  NativeTerminalStep,
  NativeTerminalTurn,
  NativeTerminalUsage,
} from '@spark-outpost/contracts';
import { lineText, noBreakParts, sessionLine, shortModel, terminalFacts } from './session-line.ts';

const ID = '00000000-0000-4000-8000-000000000001';

function chat(patch: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: ID,
    title: 'Fix billing totals',
    updatedAt: '2026-10-02T12:00:00.000Z',
    projectIds: [],
    latestRun: null,
    archivedAt: null,
    pinnedAt: null,
    pinnedOrder: null,
    projectOrder: null,
    unread: false,
    needsInput: false,
    attention: null,
    titleSource: 'message',
    category: null,
    ...patch,
  };
}

function terminal(state: string, patch: Partial<ConversationSummary> = {}) {
  return chat({
    sessionType: 'terminal',
    terminal: {
      id: ID,
      conversationId: ID,
      provider: 'claude',
      state,
      cwd: '/Users/ada/code/shop',
      label: 'shop',
      updatedAt: '2026-10-02T12:30:00.000Z',
      resumeAvailable: false,
      runId: null,
      observation: 'hooks',
      reason: null,
      agentMode: null,
    } as NonNullable<ConversationSummary['terminal']>,
    ...patch,
  });
}

function step(name: string, patch: Partial<NativeTerminalStep> = {}): NativeTerminalStep {
  return {
    id: `${name}-${patch.startedAt ?? ''}-${patch.agentId ?? ''}`,
    name,
    agentId: null,
    startedAt: '2026-10-02T12:00:00.000Z',
    endedAt: '2026-10-02T12:00:01.000Z',
    failed: false,
    ...patch,
  };
}

function turn(patch: Partial<NativeTerminalTurn> = {}): NativeTerminalTurn {
  return {
    runId: ID,
    startedAt: '2026-10-02T12:00:00.000Z',
    status: 'running',
    model: 'claude-opus-4-1[1m]',
    tokens: null,
    costUsd: 0.1234,
    costSource: 'estimated',
    steps: [],
    ...patch,
  };
}

const usage = (...turns: NativeTerminalTurn[]): NativeTerminalUsage => ({
  provider: 'claude',
  turns,
  reported: [],
  stopped: false,
});

const run = (status: string, patch: object = {}) =>
  ({
    id: ID,
    status,
    error: null,
    step: null,
    provider: 'claude',
    progress: null,
    ...patch,
  }) as ConversationSummary['latestRun'];

describe('the line for a Terminal session', () => {
  it('names the step in flight, the step and sub-agent counts, the model and the cost', () => {
    const working = usage(
      turn({ status: 'succeeded', steps: [step('Read')] }),
      turn({
        steps: [
          step('Read'),
          step('Task', { agentId: 'a1' }),
          step('Grep', { agentId: 'a1' }),
          step('Grep', { agentId: 'a2', endedAt: null }),
          step('WebSearch', { endedAt: null }),
        ],
      }),
    );
    const line = sessionLine(terminal('working'), working);
    expect(line).toEqual({
      step: 'Searching the web',
      steps: '5 steps',
      subagents: '2 sub-agents',
      model: 'Opus 4.1',
      cost: '~$0.12',
    });
    expect(lineText(line)).toBe('Searching the web · 5 steps · 2 sub-agents · Opus 4.1 · ~$0.12');
    expect(lineText(line, ['step', 'steps'])).toBe('Searching the web · 5 steps');
  });

  it('keeps the counts and cost of the last turn once it is idle, without a step', () => {
    const done = usage(
      turn({ status: 'succeeded', costSource: 'reported', steps: [step('Bash'), step('Edit')] }),
    );
    const line = sessionLine(terminal('ready'), done);
    expect(line.step).toBeNull();
    expect(lineText(line)).toBe('2 steps · Opus 4.1 · $0.12');
  });

  it('says one step and leaves out what is unknown', () => {
    const line = sessionLine(
      terminal('working'),
      usage(
        turn({ model: null, costUsd: null, costSource: null, steps: [step('lookup_weather')] }),
      ),
    );
    expect(lineText(line)).toBe('Using lookup weather · 1 step');
  });

  it('is empty before usage loads, with no turns, or when the route is refused', () => {
    expect(lineText(sessionLine(terminal('working'), undefined))).toBe('');
    expect(lineText(sessionLine(terminal('working'), usage()))).toBe('');
  });

  it('shows the card line, and no usage, while a Spark card waits', () => {
    const waiting = terminal('working', {
      needsInput: true,
      attention: {
        kind: 'permission',
        title: 'run a command',
        agentName: null,
        provider: 'claude',
        approvalId: ID,
      },
    });
    const line = sessionLine(waiting, usage(turn({ steps: [step('Bash')] })));
    expect(lineText(line)).toBe('Claude wants to run a command');
    expect(terminalFacts(waiting, line, ['step', 'steps'])).toBe('');
  });
});

describe('the line for a chat session', () => {
  it('shows the running step and the plan progress', () => {
    const running = chat({
      latestRun: run('running', {
        step: 'Reading files',
        progress: { done: 1, active: 1, total: 4 },
      }),
    });
    expect(lineText(sessionLine(running, undefined))).toBe('Reading files · Step 2 of 4');
    expect(terminalFacts(running, sessionLine(running, undefined), ['step'])).toBe('');
  });

  it('shows the attention line while it waits and nothing when quiet', () => {
    const asking = chat({
      needsInput: true,
      latestRun: run('running'),
      attention: { kind: 'plan', title: '', agentName: null, provider: null, approvalId: ID },
    });
    expect(lineText(sessionLine(asking, undefined))).toBe('The plan is ready for review');
    expect(lineText(sessionLine(chat({ latestRun: run('succeeded') }), undefined))).toBe('');
  });
});

describe('shortModel', () => {
  it('names the model the way chats do, without the context suffix', () => {
    expect(shortModel('claude-sonnet-4-5[1m]')).toBe('Sonnet 4.5');
    expect(shortModel(null)).toBeNull();
  });
});

describe('noBreakParts', () => {
  it('lets a line wrap only after a separator', () => {
    expect(noBreakParts('Finished · 3 steps · 1 sub-agent')).toBe(
      'Finished\u00a0· 3\u00a0steps\u00a0· 1\u00a0sub-agent',
    );
    expect(noBreakParts('')).toBe('');
  });
});

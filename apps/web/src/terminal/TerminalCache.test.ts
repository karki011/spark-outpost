import { describe, expect, it } from 'vitest';
import type {
  ConversationSummary,
  NativeTerminalSession,
  NativeTerminalUsage,
} from '@spark-outpost/contracts';
import { terminalIdle } from './TerminalCache.tsx';

const chat = (extra: Partial<ConversationSummary> = {}) =>
  ({
    id: 'c1',
    needsInput: false,
    latestRun: { id: 'r1', status: 'succeeded', step: null, provider: 'claude' },
    ...extra,
  }) as ConversationSummary;
const native = (state: NativeTerminalSession['state']) =>
  ({ provider: 'claude', state }) as NativeTerminalSession;
const usage = (subagentsWorking: number) =>
  ({ promptCache: { last: null, rebuilds: {}, subagentsWorking } }) as unknown as NativeTerminalUsage;

describe('terminalIdle', () => {
  it('is idle at the prompt with nothing running', () => {
    expect(terminalIdle(chat(), native('ready'), usage(0))).toBe(true);
  });

  it('is busy while a turn runs', () => {
    expect(terminalIdle(chat(), native('working'), usage(0))).toBe(false);
    const running = chat({ latestRun: { id: 'r1', status: 'running', step: null, provider: 'claude' } });
    expect(terminalIdle(running, native('ready'), usage(0))).toBe(false);
  });

  it('is busy while background sub-agents still work', () => {
    expect(terminalIdle(chat(), native('ready'), usage(1))).toBe(false);
  });

  it('is busy while the agent waits on a permission card or an answer', () => {
    expect(terminalIdle(chat(), native('waiting_for_permission'), usage(0))).toBe(false);
    expect(terminalIdle(chat({ needsInput: true }), native('ready'), usage(0))).toBe(false);
  });

  it('shows nothing once the session has ended', () => {
    expect(terminalIdle(chat(), native('exited'), usage(0))).toBe(false);
  });
});

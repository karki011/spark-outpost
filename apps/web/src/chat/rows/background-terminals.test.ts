import { describe, expect, it } from 'vitest';
import { agentTerminalFixture } from '../../terminal/dock/agent-terminal-fixture.ts';
import { backgroundLine } from './BackgroundTerminals.tsx';
import { turnRowParts } from './turn-rows.ts';

const terminal = (id: string, state: 'running' | 'exited', at: number) =>
  agentTerminalFixture({
    id,
    state,
    startedAt: new Date(1_000 + at).toISOString(),
    textOffset: null,
    textBefore: null,
    textHeld: null,
  });

describe('background commands', () => {
  it('folds terminals that run one after another into one part', () => {
    const parts = turnRowParts({
      text: '',
      steps: [],
      commands: [],
      terminals: [terminal('a', 'exited', 0), terminal('b', 'running', 10)],
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ kind: 'terminal', terminals: [{ id: 'a' }, { id: 'b' }] });
  });

  it('counts finished and running background commands', () => {
    const ended = terminal('a', 'exited', 0);
    const running = terminal('b', 'running', 0);
    expect(backgroundLine([ended, ended, running])).toBe(
      '2 background commands completed, 1 running',
    );
    expect(backgroundLine([ended])).toBe('1 background command completed');
    expect(backgroundLine([running, running])).toBe('2 background commands running');
  });
});

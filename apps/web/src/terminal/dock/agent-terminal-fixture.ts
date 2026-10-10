import type { AgentTerminal } from '@spark-outpost/contracts';

export const FIXTURE_CHAT = '01990000-0000-7000-8000-0000000000c1';
export const FIXTURE_RUN = '01990000-0000-7000-8000-0000000000aa';
export const FIXTURE_TERMINAL = '01990000-0000-7000-8000-000000000001';

export function agentTerminalFixture(change: Partial<AgentTerminal> = {}): AgentTerminal {
  return {
    id: FIXTURE_TERMINAL,
    conversationId: FIXTURE_CHAT,
    runId: FIXTURE_RUN,
    provider: 'claude',
    name: 'pnpm dev',
    command: 'pnpm dev',
    cwd: '/work/widgets',
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
  };
}

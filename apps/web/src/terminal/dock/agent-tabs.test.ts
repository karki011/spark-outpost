import { describe, expect, it } from 'vitest';
import {
  agentTabBlocked,
  agentTabBody,
  agentTabFoot,
  agentTabLabel,
  agentTabStatus,
  runningTerminalIds,
  type AgentTabFacts,
} from './agent-tabs.ts';
import { agentTerminalFixture as terminal } from './agent-terminal-fixture.ts';

function body(change: Partial<AgentTabFacts>) {
  return agentTabBody({
    terminal: terminal(),
    searching: false,
    attached: false,
    notice: null,
    saved: null,
    ...change,
  });
}

describe('what an agent tab shows', () => {
  it('waits for the list, then says when the terminal is unknown', () => {
    expect(body({ terminal: null, searching: true })).toBe('finding');
    expect(body({ terminal: null })).toBe('missing');
  });

  it('shows the live screen while it runs, and says so when no view could open', () => {
    expect(body({})).toBe('screen');
    expect(body({ notice: 'Too many terminal views are open. Close one first.' })).toBe('blocked');
    expect(agentTabBlocked('Too many terminal views are open. Close one first.')).toBe(
      'The output can’t be shown in this tab: Too many terminal views are open. Close one first. The command is still running.',
    );
  });

  it('keeps the screen it was watching when the command ends', () => {
    const ended = terminal({ state: 'exited', exitCode: 0 });
    expect(body({ terminal: ended, attached: true })).toBe('screen');
  });

  it('shows the saved output of a terminal that had ended before the tab opened', () => {
    const ended = terminal({ state: 'stopped', stoppedBy: 'quit' });
    expect(body({ terminal: ended })).toBe('loading');
    expect(body({ terminal: ended, saved: '' })).toBe('empty');
    expect(body({ terminal: ended, saved: 'ready\n', notice: 'not running' })).toBe('saved');
  });
});

describe('the tab itself', () => {
  it('is named for the agent and the command', () => {
    expect(agentTabLabel(terminal())).toBe('Claude · pnpm dev');
    expect(
      agentTabLabel(terminal({ provider: 'codex', name: '', command: 'vitest  --watch' })),
    ).toBe('Codex · vitest --watch');
  });

  it('lights up only while the terminal is live', () => {
    expect(agentTabStatus(null, true)).toBe('starting');
    expect(agentTabStatus(null, false)).toBe('ended');
    expect(agentTabStatus(terminal({ state: 'starting' }), false)).toBe('open');
    expect(agentTabStatus(terminal({ state: 'failed' }), false)).toBe('ended');
  });

  it('says how it ended', () => {
    expect(agentTabFoot(terminal())).toMatch(/Closing the tab does not stop it\.$/);
    expect(agentTabFoot(terminal({ state: 'exited', exitCode: 3 }))).toBe('How it ended: exit 3.');
    expect(agentTabFoot(terminal({ state: 'stopped', stoppedBy: 'turn_stopped' }))).toBe(
      'How it ended: stopped with the turn.',
    );
  });

  it('rebuilds tabs only for the terminals still running', () => {
    const second = '01990000-0000-7000-8000-000000000002';
    expect(
      runningTerminalIds([
        terminal(),
        terminal({ id: second, state: 'exited', exitCode: 0 }),
        terminal({ id: '01990000-0000-7000-8000-000000000003', state: 'starting' }),
      ]),
    ).toEqual([terminal().id, '01990000-0000-7000-8000-000000000003']);
    expect(runningTerminalIds(undefined)).toEqual([]);
  });
});

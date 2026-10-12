import { describe, expect, it } from 'vitest';
import { runningText } from './RunningLine.tsx';
import type { Worker } from './status-store.ts';

const claude: Worker = { id: 'r', name: 'Claude', provider: 'claude', kind: 'agent' };

describe('the line above the message box while a turn runs', () => {
  it('says the agent waits on its sub-agents instead of naming a step', () => {
    expect(runningText({ ...claude, doing: 'waiting on 2 sub-agents' }, null)).toBe(
      'Claude is waiting on 2 sub-agents…',
    );
  });

  it('says the agent is thinking when it reports nothing else', () => {
    expect(runningText(claude, null)).toBe('Claude is thinking…');
  });
});

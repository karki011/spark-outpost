import { describe, expect, it } from 'vitest';
import { chooseTask } from './rules.ts';

const open = { id: 't1', status: 'open' as const };
const closed = { id: 't1', status: 'closed' as const };

describe('chooseTask', () => {
  it('joins the open task, even for a follow-up that only chats', () => {
    expect(chooseTask(open, false)).toEqual({ kind: 'join', taskId: 't1' });
    expect(chooseTask(open, true)).toEqual({ kind: 'join', taskId: 't1' });
  });

  it('opens a task once a run starts working and no task is open', () => {
    expect(chooseTask(null, true)).toEqual({ kind: 'open' });
    expect(chooseTask(closed, true)).toEqual({ kind: 'open' });
  });

  it('leaves chit-chat without a task', () => {
    expect(chooseTask(null, false)).toEqual({ kind: 'none' });
    expect(chooseTask(closed, false)).toEqual({ kind: 'none' });
  });
});

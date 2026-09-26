import { describe, expect, it } from 'vitest';
import { activityFromEvents } from './activity.ts';

describe('activityFromEvents', () => {
  it('keeps steps that never finished open, per run', () => {
    const activity = activityFromEvents([
      { run_id: 'a', type: 'STEP_STARTED', name: 'Read `x.ts`' },
      { run_id: 'a', type: 'STEP_FINISHED', name: 'Read `x.ts`' },
      { run_id: 'a', type: 'STEP_STARTED', name: 'Edit `x.ts`' },
      { run_id: 'b', type: 'STEP_STARTED', name: 'Thinking' },
      { run_id: 'b', type: 'STEP_STARTED', name: 'Thinking' },
      { run_id: 'b', type: 'STEP_FINISHED', name: 'Thinking' },
    ]);
    expect(activity).toEqual({
      a: [
        { name: 'Read `x.ts`', done: true },
        { name: 'Edit `x.ts`', done: false },
      ],
      b: [
        { name: 'Thinking', done: true },
        { name: 'Thinking', done: false },
      ],
    });
  });
});

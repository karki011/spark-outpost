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

  it('links the thinking text to the Thinking step it was stored under', () => {
    const activity = activityFromEvents([
      { run_id: 'a', type: 'STEP_STARTED', name: 'Thinking' },
      { run_id: 'a', type: 'REASONING_START', name: 'thought-1' },
      { run_id: 'a', type: 'STEP_FINISHED', name: 'Thinking' },
      { run_id: 'a', type: 'REASONING_START', name: 'orphan' },
      { run_id: 'b', type: 'REASONING_START', name: 'no-step' },
    ]);
    expect(activity).toEqual({
      a: [{ name: 'Thinking', done: true, reasoningId: 'thought-1' }],
      b: [],
    });
  });

  it('pairs thousands of interleaved steps oldest first', () => {
    const rows = [];
    for (let index = 0; index < 5000; index += 1) {
      rows.push({ run_id: 'big', type: 'STEP_STARTED', name: `Step ${index % 50}` });
    }
    for (let index = 0; index < 2500; index += 1) {
      rows.push({ run_id: 'big', type: 'STEP_FINISHED', name: `Step ${index % 50}` });
    }
    rows.push({ run_id: 'big', type: 'STEP_FINISHED', name: 'Never started' });

    const started = performance.now();
    const steps = activityFromEvents(rows).big ?? [];
    const elapsed = performance.now() - started;

    expect(steps).toHaveLength(5000);
    expect(steps.slice(0, 2500).every((step) => step.done)).toBe(true);
    expect(steps.slice(2500).some((step) => step.done)).toBe(false);
    expect(elapsed).toBeLessThan(200);
  });
});

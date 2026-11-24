import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOutputFlow,
  FLOW_CHECK_MS,
  FLOW_HIGH_BYTES,
  FLOW_LOW_BYTES,
  FLOW_STALL_MS,
} from './output-flow.ts';

function fixture() {
  const calls: string[] = [];
  const state = { buffered: 0 };
  const flow = createOutputFlow(
    { pause: () => calls.push('pause'), resume: () => calls.push('resume') },
    () => state.buffered,
  );
  return { calls, state, flow };
}

describe('terminal output flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never pauses for a view that does not acknowledge output', () => {
    const { calls, flow } = fixture();
    flow.sent(FLOW_HIGH_BYTES * 10);
    vi.advanceTimersByTime(FLOW_STALL_MS * 2);
    expect(calls).toEqual([]);
  });

  it('pauses once past the high mark and resumes below the low mark', () => {
    const { calls, flow } = fixture();
    flow.acked(0);
    flow.sent(FLOW_HIGH_BYTES);
    expect(calls).toEqual([]);
    flow.sent(1);
    flow.sent(5000);
    expect(calls).toEqual(['pause']);
    flow.acked(FLOW_HIGH_BYTES - FLOW_LOW_BYTES);
    expect(calls).toEqual(['pause']);
    flow.acked(6000);
    expect(calls).toEqual(['pause', 'resume']);
  });

  it('ignores an acknowledgement for more than was sent', () => {
    const { calls, flow } = fixture();
    flow.acked(FLOW_HIGH_BYTES * 5);
    flow.sent(FLOW_HIGH_BYTES + 1);
    expect(calls).toEqual(['pause']);
  });

  it('pauses while the socket is backed up and resumes when it drains', () => {
    const { calls, state, flow } = fixture();
    state.buffered = FLOW_HIGH_BYTES + 1;
    flow.sent(10);
    expect(calls).toEqual(['pause']);
    vi.advanceTimersByTime(FLOW_CHECK_MS * 3);
    expect(calls).toEqual(['pause']);
    state.buffered = 0;
    vi.advanceTimersByTime(FLOW_CHECK_MS);
    expect(calls).toEqual(['pause', 'resume']);
  });

  it('resumes by itself when a view stops acknowledging', () => {
    const { calls, flow } = fixture();
    flow.acked(0);
    flow.sent(FLOW_HIGH_BYTES + 1);
    vi.advanceTimersByTime(FLOW_STALL_MS - FLOW_CHECK_MS);
    expect(calls).toEqual(['pause']);
    vi.advanceTimersByTime(FLOW_CHECK_MS * 2);
    expect(calls).toEqual(['pause', 'resume']);
    flow.sent(FLOW_HIGH_BYTES * 4);
    expect(calls).toEqual(['pause', 'resume']);
  });

  it('resumes when the view goes away while paused, and only once', () => {
    const { calls, flow } = fixture();
    flow.acked(0);
    flow.sent(FLOW_HIGH_BYTES + 1);
    flow.stop();
    flow.stop();
    vi.advanceTimersByTime(FLOW_STALL_MS * 2);
    expect(calls).toEqual(['pause', 'resume']);
  });
});

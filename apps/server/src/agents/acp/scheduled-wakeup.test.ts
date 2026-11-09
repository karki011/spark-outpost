import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable';
import { describe, expect, it } from 'vitest';
import { createBackgroundWork } from './background-work.ts';

const WAKES_AT = 1_792_680_480_000;

function wakeupResponse(toolResponse: Record<string, unknown>, call = 'wake-1'): SessionUpdate {
  return {
    sessionUpdate: 'tool_call_update',
    toolCallId: call,
    _meta: { claudeCode: { toolName: 'ScheduleWakeup', toolResponse } },
  };
}

function wakeupText(rawOutput: string, call = 'wake-1'): SessionUpdate {
  return {
    sessionUpdate: 'tool_call_update',
    toolCallId: call,
    status: 'completed',
    rawOutput,
    _meta: { claudeCode: { toolName: 'ScheduleWakeup' } },
  };
}

const SCHEDULED = 'Next wakeup scheduled for 10:48:00 (in 67s). Nothing more to do this turn.';

function sleeper(at: { now: number }) {
  return createBackgroundWork(() => at.now);
}

describe('a wakeup the agent scheduled', () => {
  it('keeps the work busy until its time, at the time the tool reported', () => {
    const work = sleeper({ now: WAKES_AT - 67_000 });
    work.see(
      wakeupResponse({ scheduledFor: WAKES_AT, clampedDelaySeconds: 60, wasClamped: false }),
    );
    work.see(wakeupText(SCHEDULED));
    expect(work.count()).toEqual({ agents: 0, tasks: 0, names: [], wakesAt: WAKES_AT });
    expect(work.busy()).toBe(true);
  });

  it('reads the time from the tool’s text when the tool response is missing', () => {
    const work = sleeper({ now: 1_000_000 });
    work.see(wakeupText(SCHEDULED));
    expect(work.count().wakesAt).toBe(1_067_000);
  });

  it('reads the time from the result content when the adapter sends no raw output', () => {
    const work = sleeper({ now: 1_000_000 });
    work.see({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'wake-1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: SCHEDULED } }],
      _meta: { claudeCode: { toolName: 'ScheduleWakeup', toolResponse: { status: 'ok' } } },
    });
    expect(work.count().wakesAt).toBe(1_067_000);
  });

  it('ends when the agent stops it or the wakeup is not scheduled', () => {
    const at = { now: WAKES_AT - 60_000 };
    const stopped = sleeper(at);
    stopped.see(wakeupResponse({ scheduledFor: WAKES_AT, clampedDelaySeconds: 60 }));
    stopped.see(
      wakeupResponse({ scheduledFor: 0, clampedDelaySeconds: 0, stopped: true }, 'wake-2'),
    );
    expect(stopped.busy()).toBe(false);

    const refused = sleeper(at);
    refused.see(wakeupText('Wakeup not scheduled. The loop reached its maximum duration.'));
    expect(refused.busy()).toBe(false);
  });

  it('is woken by a cycle that starts near its time, and not by one long before it', () => {
    const at = { now: WAKES_AT - 600_000 };
    const work = sleeper(at);
    work.see(wakeupResponse({ scheduledFor: WAKES_AT, clampedDelaySeconds: 600 }));
    work.cycleStarted();
    expect(work.busy()).toBe(true);
    at.now = WAKES_AT - 30_000;
    work.cycleStarted();
    expect(work.busy()).toBe(false);
    expect(work.count()).toEqual({ agents: 0, tasks: 0, names: [] });
  });

  it('ignores other tools’ results', () => {
    const work = sleeper({ now: 0 });
    work.see({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'bash-1',
      rawOutput: SCHEDULED,
      _meta: { claudeCode: { toolName: 'Bash', toolResponse: { scheduledFor: WAKES_AT } } },
    });
    expect(work.busy()).toBe(false);
  });
});

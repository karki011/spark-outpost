import { describe, expect, it, vi } from 'vitest';
import { memorySecretStore } from '../setup/secrets.ts';
import type { Session } from './session.ts';
import { takeNudge, watchdogState, watchMember } from './watchdog.ts';

const PARENT = '00000000-0000-4000-8000-000000000001';
const CHILD = '00000000-0000-4000-8000-000000000002';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const noul = (value: number) => ({ type: 'noul', noul: value });

function harness(level: Session['input']['level'], callBudget: number, stuckAt = 0.95) {
  const decisions: Record<string, unknown>[] = [];
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO run_advice')) {
        decisions.push(JSON.parse(String(params[5])) as Record<string, unknown>);
      }
      return { rows: [] };
    }),
  };
  const jev = { calls: 0, inFlight: 0, maxInFlight: 0 };
  const fetch = (async () => {
    jev.calls += 1;
    jev.inFlight += 1;
    jev.maxInFlight = Math.max(jev.maxInFlight, jev.inFlight);
    await pause(25);
    jev.inFlight -= 1;
    const answers = {
      repeating: noul(stuckAt),
      off_step: noul(0.1),
      waiting: noul(0.1),
      finished: noul(0.1),
    };
    return new Response(
      JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 900 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof globalThis.fetch;
  const stop = vi.fn();
  const s = {
    deps: { db, watchdog: { everyToolCalls: 2, pollMs: 60_000, callBudget } },
    lease: { runId: PARENT },
    input: { level, workspaceId: PARENT },
    flow: { steps: ['Add the parser in src/parse.ts'] },
    control: { signal: new AbortController().signal, stop, reason: () => null },
    jev: {
      deps: { db, secrets: memorySecretStore({ jev: 'k' }), fetch, baseUrl: 'https://t.test' },
      model: 'jev-latest',
    },
  } as unknown as Session;
  const watch = watchMember(s, {
    runId: CHILD,
    childRunId: CHILD,
    name: 'Bolt',
    role: 'builder',
    stepIndex: 0,
    steps: [0],
    ticked: () => [],
  });
  return { s, watch, jev, decisions, stop };
}

async function loop(observe: (output: never) => void, count: number) {
  for (let index = 0; index < count; index += 1) {
    observe({
      kind: 'step_started',
      name: 'Read `src/parse.ts`',
      tool: true,
      toolKind: 'read',
    } as never);
    await pause(10);
  }
}

describe('watching a member', () => {
  it('keeps one Jev call in flight per member, within the call budget', async () => {
    const { watch, jev, decisions } = harness('full-auto', 2);
    await loop(watch.observe, 24);
    await watch.stop();
    expect(jev.maxInFlight).toBe(1);
    expect(jev.calls).toBe(2);
    expect(decisions.length).toBeGreaterThanOrEqual(2);
    expect(decisions[0]).toMatchObject({
      applied: 'jev',
      answer: { member: 'Bolt', flagged: true, reason: 'repeating', action: 'nudge' },
    });
  });

  it('queues a nudge at Full auto, once per cooldown, and never stops the run', async () => {
    const { s, watch, decisions, stop } = harness('full-auto', 3);
    await loop(watch.observe, 24);
    await watch.stop();
    const actions = decisions.map((body) => (body.answer as { action: string }).action);
    expect(actions.slice(0, 3)).toEqual(['nudge', 'held', 'nudge']);
    expect(takeNudge(s, 'Bolt')).toContain('You seemed to be repeating Read src/parse.ts.');
    expect(takeNudge(s, 'Bolt')).toBeNull();
    expect(stop).not.toHaveBeenCalled();
  });

  it('records a healthy check and takes no action', async () => {
    const { s, watch, decisions } = harness('balanced', 1, 0.05);
    await loop(watch.observe, 3);
    await watch.stop();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ answer: { flagged: false, action: 'none' } });
    expect(watchdogState(s).nudges.size).toBe(0);
  });

  it('does nothing when the watchdog is off', async () => {
    const { s } = harness('full-auto', 5);
    const off = watchMember({ ...s, deps: { ...s.deps, watchdog: false } } as Session, {
      runId: CHILD,
      childRunId: CHILD,
      name: 'Bolt',
      role: 'builder',
      stepIndex: 0,
      steps: [0],
      ticked: () => [],
    });
    await loop(off.observe, 4);
    await off.stop();
    expect(watchdogState(s).calls).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import type { Db } from '../persistence/db.ts';
import { checkBudget, meterSpend } from './budget-check.ts';
import type { Session } from './session.ts';

interface SlowDb {
  db: Db;
  busiest: () => number;
  spentQueries: () => number;
}

function slowDb(spent = 0): SlowDb {
  let inFlight = 0;
  let busiest = 0;
  let spentQueries = 0;
  const query = async (text: string) => {
    inFlight += 1;
    busiest = Math.max(busiest, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    if (text.includes('SUM(cost_usd)')) {
      spentQueries += 1;
      return { rows: [{ spent: String(spent) }] };
    }
    return { rows: [] };
  };
  return {
    db: { query } as unknown as Db,
    busiest: () => busiest,
    spentQueries: () => spentQueries,
  };
}

function session(db: Db, costCapUsd: number | null = null): Session {
  return {
    deps: { db },
    lease: { runId: 'run' },
    flow: { phase: 'building', depth: 'execute', retries: 0 },
    limits: { activeLimitMs: 60_000, toolCallLimit: 100, costCapUsd },
    toolCalls: 0,
    startedAt: Date.now(),
    budgetHit: null,
    members: new Map(),
    liveCost: new Map(),
  } as unknown as Session;
}

describe('checkBudget', () => {
  it('never runs two checks at once and folds waiting callers into one more check', async () => {
    const fake = slowDb();
    const s = session(fake.db);
    const results = await Promise.all(Array.from({ length: 6 }, () => checkBudget(s)));
    expect(results).toEqual([null, null, null, null, null, null]);
    expect(fake.spentQueries()).toBe(2);
  });

  it('keeps each check to its own queries', async () => {
    const fake = slowDb();
    const s = session(fake.db);
    await Promise.all([checkBudget(s), checkBudget(s), checkBudget(s)]);
    expect(fake.busiest()).toBeLessThanOrEqual(1);
  });
});

describe('meterSpend', () => {
  it('stops every member at once when live spend crosses the cap', () => {
    const s = session(slowDb().db, 0.1);
    const stopped: string[] = [];
    s.members.set('a', () => stopped.push('a'));
    s.members.set('b', () => stopped.push('b'));
    s.liveCost.set('a', 0.06);
    meterSpend(s);
    expect(stopped).toEqual([]);
    s.liveCost.set('b', 0.05);
    meterSpend(s);
    expect(s.budgetHit).toBe('cost');
    expect(stopped).toEqual(['a', 'b']);
  });
});

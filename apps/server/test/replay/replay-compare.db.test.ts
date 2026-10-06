import { describe, expect, it } from 'vitest';
import { REPLAY_CASES } from './replay-cases.ts';
import { runReplay } from './replay-support.ts';

const caseOf = (id: string) => REPLAY_CASES.find((candidate) => candidate.id === id)!;

async function rowOf(id: string, harness: 'current' | 'simple') {
  const result = await runReplay(caseOf(id), harness);
  try {
    return result.row;
  } finally {
    await result.cleanup();
  }
}

describe('one conversation session per chat and provider', { timeout: 300_000 }, () => {
  it('a one-line follow-up opens no new session and gets the same answers under both settings', async () => {
    const [current, simple] = await Promise.all([
      rowOf('follow-up', 'current'),
      rowOf('follow-up', 'simple'),
    ]);
    expect(simple.replies).toEqual(current.replies);
    expect(simple.newSessionsLastTurn).toBe(0);
    expect(simple.opened + simple.replaced).toBe(current.opened + current.replaced);
    expect(simple.runs).toBe(current.runs);
  });

  it('a status question after build turns opens a session today and none under simple', async () => {
    const [current, simple] = await Promise.all([
      rowOf('status', 'current'),
      rowOf('status', 'simple'),
    ]);
    expect(current.newSessionsLastTurn).toBe(1);
    expect(simple.newSessionsLastTurn).toBe(0);
    expect(simple.opened + simple.replaced).toBe(1);
    expect(simple.modelChanges).toBe(0);
    expect(simple.runs).toBe(current.runs);
    expect(simple.replies.slice(0, 2)).toEqual(current.replies.slice(0, 2));
    const asked = caseOf('status').turns.at(-1)!.scenario.text;
    expect(simple.replies.at(-1)).toContain('mode=read-only');
    expect(simple.replies.at(-1)).toContain(`prompt=${asked}`);
    expect(simple.promptTokens).toBeLessThan(current.promptTokens);
  });
});

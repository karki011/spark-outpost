import { describe, expect, it } from 'vitest';
import { REPLAY_CASES } from './replay-cases.ts';
import { runReplay } from './replay-support.ts';

const caseOf = (id: string) => REPLAY_CASES.find((candidate) => candidate.id === id)!;

async function rowOf(id: string) {
  const result = await runReplay(caseOf(id));
  try {
    return result.row;
  } finally {
    await result.cleanup();
  }
}

describe('one conversation session per chat and provider', { timeout: 300_000 }, () => {
  it('a one-line follow-up opens no new session', async () => {
    const row = await rowOf('follow-up');
    expect(row.newSessionsLastTurn).toBe(0);
  });

  it('a status question after build turns opens no session and reads the same one', async () => {
    const row = await rowOf('status');
    expect(row.newSessionsLastTurn).toBe(0);
    expect(row.opened + row.replaced).toBe(1);
    expect(row.modelChanges).toBe(0);
    const asked = caseOf('status').turns.at(-1)!.scenario.text;
    expect(row.replies.at(-1)).toContain('mode=read-only');
    expect(row.replies.at(-1)).toContain(`prompt=${asked}`);
  });
});

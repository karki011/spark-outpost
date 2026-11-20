import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { compactBeforeTurn } from '../src/compaction/before-turn.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import type { Lease } from '../src/persistence/jobs.ts';
import type { Provider, ProviderTurn } from '../src/providers/provider.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import {
  compactionsOf,
  newChat,
  percentOf,
  promptsOf,
  say,
  sessionsOf,
  startCompactionHarness,
  type CompactionHarness,
} from './compaction-support.ts';

let h: CompactionHarness;

afterEach(async () => {
  await h.stop();
});

function recordingProvider(prompts: string[]): Provider {
  return {
    name: 'claude',
    async *run(turn: ProviderTurn) {
      prompts.push(turn.prompt);
      yield* [];
    },
  };
}

describe('compaction candidates', { timeout: 60_000 }, () => {
  it('sends no /compact when Stop arrives before the request goes out', async () => {
    h = await startCompactionHarness(['compact']);
    const id = await newChat(h, 'hands-off');
    await say(h, id, 'Start #ctx90');
    await h.worker.stop();
    const { run } = await sendUserMessage(
      h.t.db,
      id,
      { id: randomUUID(), content: 'Next' },
      { provider: 'claude', model: 'sonnet', effort: 'medium', permission: 'ask' },
    );
    const input = await loadRunInput(h.t.db, run.id);
    const prompts: string[] = [];
    const stop = new AbortController();
    const steps: string[] = [];

    const result = await compactBeforeTurn(
      {
        db: h.t.db,
        providers: new Map([['claude', recordingProvider(prompts)]]),
        leaseSeconds: 30,
      },
      { jobId: randomUUID(), runId: run.id, token: randomUUID(), attempt: 1 } satisfies Lease,
      input,
      async (event) => {
        if (event.type === 'STEP_STARTED') {
          steps.push(String(event.stepName));
          stop.abort();
        }
        return null;
      },
      { signal: stop.signal },
    );

    expect(steps).toEqual(['Sent /compact to the agent (180K tokens)']);
    expect(result).toEqual({ kind: 'stopped' });
    expect(prompts).toEqual([]);
    expect(await compactionsOf(h, id)).toEqual([]);
    expect((await sessionsOf(h, id)).map((session) => session.close_reason)).toEqual([null]);
  });

  it('offers only the session the next turn resumes', async () => {
    h = await startCompactionHarness(['compact']);
    const id = await newChat(h, 'hands-off');
    await say(h, id, 'Start #ctx20');
    await h.t.db.query(
      `INSERT INTO provider_sessions
       SELECT (jsonb_populate_record(NULL::provider_sessions, to_jsonb(s) || jsonb_build_object(
         'id', gen_random_uuid(), 'session_id', 'stale-mode-session', 'agent_key', 'chat:do',
         'context_used', $2::int, 'workdir', s.workdir || '-do'))).*
       FROM provider_sessions s WHERE s.conversation_id = $1`,
      [id, percentOf(90)],
    );

    const next = await say(h, id, 'Next');

    expect(next.run.status).toBe('succeeded');
    expect(next.steps.some((step) => step.includes('ompact'))).toBe(false);
    expect(await compactionsOf(h, id)).toEqual([]);
    const sessions = await sessionsOf(h, id);
    const resumed = sessions.find((session) => session.session_id !== 'stale-mode-session');
    expect(resumed?.close_reason).toBeNull();
    expect(promptsOf(h, resumed!.session_id).at(-1)?.startsWith('Next')).toBe(true);
  });
});

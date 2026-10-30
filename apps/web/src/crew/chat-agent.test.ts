import { describe, expect, it } from 'vitest';
import { chatAgent } from './chat-agent.ts';
import { crewJob } from '../chat/rail/rail-model.ts';
import { run } from './test-run.ts';

describe("the chat's own agent on Agent TV and in the rail", () => {
  it('is named after the provider and carries the model, cost and time of its run', () => {
    const agent = chatAgent(
      run({
        usage: {
          contextUsed: null,
          contextSize: null,
          costUsd: 0.04,
          costSource: 'reported',
          tokens: {
            input: 900,
            output: 300,
            total: 1200,
            cachedRead: null,
            cachedWrite: null,
            thought: null,
          },
        },
      }),
    );
    expect(agent).toMatchObject({
      name: 'Claude',
      state: 'done',
      line: 'done',
      tokens: 1200,
      costUsd: 0.04,
      durationMs: 38_000,
    });
    expect(crewJob(agent)).toBe('Agent · Sonnet 5 · medium');
  });

  it("names the lead's live step over a stale stored step, cut to fit", () => {
    const live = run({ status: 'running', finishedAt: null });
    const stale = [{ name: 'Thinking', done: false }];
    const publishing = { label: 'Opening pull request', since: 1 };
    expect(chatAgent(live, stale, false, 0, null, publishing)).toMatchObject({
      state: 'working',
      line: 'opening pull request',
    });
    const long = { label: `Running ${'pnpm test --filter web '.repeat(4)}`, since: 1 };
    const line = chatAgent(live, [], false, 0, null, long).line;
    expect(line.length).toBeLessThanOrEqual(60);
    expect(line.endsWith('…')).toBe(true);
    expect(chatAgent(live, [], true, 0, null, publishing).line).toBe('waiting for you');
  });

  it('says it waits on its sub-agents while it has no step of its own', () => {
    const live = run({ status: 'running', finishedAt: null });
    const steps = [{ name: 'Read routes.ts', done: false }];
    expect(chatAgent(live, steps, false, 2).line).toBe('waiting on 2 sub-agents');
    expect(chatAgent(live, steps, true, 2).line).toBe('waiting for you');
    expect(chatAgent(run(), steps, false, 2).line).toBe('done');
  });

  it('names the model the session reported running, not the id the chat was pinned to', () => {
    expect(crewJob(chatAgent(run({ model: 'sonnet', usedModel: 'claude-sonnet-5-5' })))).toBe(
      'Agent · Sonnet 5.5 · medium',
    );
    expect(crewJob(chatAgent(run({ model: 'sonnet', usedModel: null })))).toBe(
      'Agent · Sonnet · medium',
    );
    expect(crewJob(chatAgent(run({ model: 'default', usedModel: 'claude-opus-5-5[1m]' })))).toBe(
      'Agent · Opus 5.5 · medium',
    );
  });

  it('follows the run: thinking, its open step, waiting for the user, stopped, failed', () => {
    const running = run({ status: 'running', finishedAt: null });
    expect(chatAgent(running)).toMatchObject({ state: 'thinking', line: 'thinking' });
    expect(chatAgent(running, [{ name: 'Run `pnpm test`', done: false }])).toMatchObject({
      state: 'working',
      line: 'run pnpm test',
    });
    expect(chatAgent(running, [], true)).toMatchObject({
      state: 'waiting',
      line: 'waiting for you',
    });
    expect(chatAgent(run({ status: 'cancelled' })).state).toBe('stopped');
    expect(chatAgent(run({ status: 'failed' })).line).toBe('hit a problem');
  });
});

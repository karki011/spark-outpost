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

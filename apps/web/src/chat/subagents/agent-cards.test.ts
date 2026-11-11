import { describe, expect, it } from 'vitest';
import { emptySubagentRecord, type SubagentRow } from '@spark-outpost/contracts';
import { agentCounts, agentActivity, agentMeta, agentPurpose, agentsLine } from './agent-cards.ts';

function row(change: Partial<SubagentRow>): SubagentRow {
  return {
    ...emptySubagentRecord,
    id: 'a',
    name: 'Server architecture',
    task: '',
    parentId: null,
    state: 'working',
    step: null,
    startedAt: 1_000,
    endedAt: null,
    ...change,
  };
}

describe('the sub-agents line', () => {
  it('waits on the working agents and counts the finished ones', () => {
    const counts = agentCounts([
      row({ id: 'a', state: 'done' }),
      row({ id: 'b' }),
      row({ id: 'c' }),
    ]);
    expect(agentsLine(counts)).toBe('Waiting on 2 agents · 1 done · writing up when all finish');
  });

  it('sums up once every agent has ended', () => {
    const counts = agentCounts([
      row({ id: 'a', state: 'done' }),
      row({ id: 'b', state: 'failed' }),
      row({ id: 'c', state: 'cancelled' }),
    ]);
    expect(agentsLine(counts)).toBe('3 agents · 1 done · 1 failed · 1 stopped');
  });

  it('says one agent in the singular', () => {
    expect(agentsLine(agentCounts([row({})]))).toBe(
      'Waiting on 1 agent · writing up when all finish',
    );
  });
});

describe('an agent card', () => {
  it('takes the first sentence of the task as its purpose', () => {
    expect(
      agentPurpose(
        'Map the Express server: routes, workers and persistence. Then list the tests.',
        'x',
      ),
    ).toBe('Map the Express server: routes, workers and persistence.');
    expect(agentPurpose('List the test setup\nand how to run it', 'x')).toBe('List the test setup');
    expect(agentPurpose('Explore', 'Explore')).toBeNull();
    expect(agentPurpose('  ', 'Explore')).toBeNull();
  });

  it('adds the next sentence when the first one is too short to say much', () => {
    expect(agentPurpose('Read-only. List every Express route in server/. Then stop.', 'x')).toBe(
      'Read-only. List every Express route in server/.',
    );
  });

  it('says what a working agent does now, falling back to its latest step', () => {
    const steps = [{ name: 'Read `a.ts`', done: true }];
    expect(agentActivity(row({ step: 'Grep', steps }))).toMatchObject({ text: 'Grep' });
    expect(agentActivity(row({ steps }))).toMatchObject({ text: 'Read `a.ts`', full: 'Read a.ts' });
    expect(agentActivity(row({ steps, state: 'done' }))).toBeNull();
  });

  it('keeps file names with dots inside the first sentence', () => {
    expect(agentPurpose('Read playwright.config.ts and say which ports it uses.', 'x')).toBe(
      'Read playwright.config.ts and say which ports it uses.',
    );
  });

  it('shows the latest command only while the agent works', () => {
    const commands = ['ls', 'grep -rn "useQuery" apps/web/src/chat'];
    expect(agentActivity(row({ commands }))).toEqual({
      text: commands[1],
      command: true,
      full: commands[1],
    });
    expect(agentActivity(row({ commands, state: 'done' }))).toBeNull();
  });

  it('shows one line when the current step is the latest command', () => {
    const command = 'cd "/tmp/x y" &&  grep -n "a\\|b" file.html';
    const step = `Allowed \`${command.replace(/\s+/g, ' ')}\` (Bypass permissions)`;
    expect(agentActivity(row({ step, commands: [command] }))).toMatchObject({
      text: command,
      command: true,
    });
    const reading = agentActivity(row({ step: 'Read routes.ts', commands: [command] }));
    expect(reading).toMatchObject({ text: 'Read routes.ts', command: false });
  });

  it('shows the step count while working and the time and tokens when done', () => {
    const steps = [
      { name: 'Read', done: true },
      { name: 'Grep', done: false },
    ];
    expect(agentMeta(row({ steps }))).toBe('2 steps');
    expect(
      agentMeta(
        row({ steps, state: 'done', usage: { durationMs: 48_000, tokens: 61_234 }, endedAt: 9 }),
      ),
    ).toBe('48s · 61K tok');
    expect(agentMeta(row({ state: 'done', startedAt: 1_000, endedAt: 76_000 }))).toBe('1m 15s');
  });

  it('leads the meta with the model and effort once they are known', () => {
    const steps = [{ name: 'Read', done: false }];
    const usage = { model: 'claude-opus-5-5', effort: 'high' };
    expect(agentMeta(row({ steps, usage }))).toBe('Opus 5.5 · High · 1 step');
    expect(
      agentMeta(
        row({
          state: 'done',
          usage: { ...usage, durationMs: 41_000, tokens: 3_000 },
          endedAt: 9,
        }),
      ),
    ).toBe('Opus 5.5 · High · 41s · 3K tok');
    expect(agentMeta(row({ steps, usage: { effort: 'high' } }))).toBe('1 step');
  });
});

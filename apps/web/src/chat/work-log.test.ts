import { describe, expect, it } from 'vitest';
import { turnHeading } from './WorkLog.tsx';
import type { StepView } from './run-projection.ts';

const steps = (count: number): StepView[] =>
  Array.from({ length: count }, (_, index) => ({ name: `Step ${index}`, status: 'done' }));

describe('turnHeading', () => {
  it('says how long a finished turn worked', () => {
    expect(turnHeading(steps(3), 'done', 19)).toBe('worked for 19s');
  });

  it('names the current step while a collapsed turn works', () => {
    const views: StepView[] = [
      { name: 'Read', status: 'done' },
      { name: 'mcp__spark__spark_pull_requests', status: 'open' },
    ];
    expect(turnHeading(views, 'working', null, false)).toBe('Checking pull requests · 2 steps');
    expect(turnHeading(views, 'working', null, true)).toBe('2 steps');
    expect(turnHeading(views, 'stopped', null, false)).toBe('2 steps');
  });

  it("names the agent's own step, never a sub-agent's, and only the count while it waits", () => {
    const views: StepView[] = [
      { name: 'Read plan.md', status: 'open' },
      { name: 'node scripts/slow.mjs', status: 'open', subagent: true },
    ];
    expect(turnHeading(views, 'working', null, false)).toBe('Read plan.md · 2 steps');
    expect(turnHeading(views, 'waiting', null, false)).toBe('2 steps');
  });

  it('counts steps otherwise', () => {
    expect(turnHeading(steps(1), 'working', null)).toBe('1 step');
    expect(turnHeading(steps(4), 'stopped', 12)).toBe('4 steps');
    expect(turnHeading(steps(2), 'done', null)).toBe('2 steps');
  });
});

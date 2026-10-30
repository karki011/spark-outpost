import { describe, expect, it } from 'vitest';
import { leadStep, type LeadInput } from './live-label.ts';

const command = (status: 'running' | 'completed', description: string | null = null) => ({
  status,
  description,
  command: 'python3 -c "import time; time.sleep(9)"',
  startedAt: '2026-10-29T10:00:00.000Z',
});

const none: LeadInput = { subagents: [], commands: [], steps: [], publishing: null };

describe('leadStep', () => {
  it('names a working sub-agent first, then the running command with its start', () => {
    expect(leadStep({ ...none, subagents: [{ state: 'working' }] }).label).toBe('Running agent');
    expect(
      leadStep({ ...none, subagents: [{ state: 'working' }, { state: 'working' }] }).label,
    ).toBe('Running 2 agents');
    expect(
      leadStep({ ...none, subagents: [{ state: 'done' }], commands: [command('running')] }),
    ).toEqual({ label: 'Running python3…', since: Date.parse('2026-10-29T10:00:00.000Z') });
    expect(leadStep({ ...none, commands: [command('running', 'Wait for the build')] }).label).toBe(
      'Running Wait for the build',
    );
  });

  it('names the open step and when it started', () => {
    const steps = [
      { name: 'Read `a.ts`', done: true, startedAt: 1 },
      { name: 'Changing Jira', done: false, startedAt: 5 },
    ];
    expect(leadStep({ ...none, steps })).toEqual({ label: 'Changing Jira', since: 5 });
  });

  it('says Publishing after the reply and Thinking when nothing is open', () => {
    const steps = [{ name: 'Read `a.ts`', done: true }];
    expect(leadStep({ ...none, steps, publishing: { since: 9 } })).toEqual({
      label: 'Publishing',
      since: 9,
    });
    expect(leadStep({ ...none, commands: [command('completed')], steps })).toEqual({
      label: 'Thinking',
      since: null,
    });
  });
});

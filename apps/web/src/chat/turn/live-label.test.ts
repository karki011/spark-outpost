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
    ).toEqual({
      label: 'Running python3…',
      since: Date.parse('2026-10-29T10:00:00.000Z'),
      repeatsRow: true,
    });
    expect(leadStep({ ...none, commands: [command('running', 'Wait for the build')] }).label).toBe(
      'Wait for the build',
    );
  });

  it('names the open step and when it started', () => {
    const steps = [
      { name: 'Read `a.ts`', done: true, startedAt: 1 },
      { name: 'Changing Jira', done: false, startedAt: 5 },
    ];
    expect(leadStep({ ...none, steps })).toEqual({ label: 'Changing Jira', since: 5 });
  });

  it('carries the streaming thought of an open Thinking step, and nothing for other steps', () => {
    const thinking = { name: 'Thinking', done: false, startedAt: 3, thought: '  Check the tests ' };
    expect(leadStep({ ...none, steps: [thinking] })).toEqual({
      label: 'Thinking',
      since: 3,
      thought: 'Check the tests',
    });
    expect(leadStep({ ...none, steps: [{ ...thinking, thought: ' ' }] })).toEqual({
      label: 'Thinking',
      since: 3,
    });
    expect(leadStep({ ...none, steps: [{ ...thinking, name: 'Read `a.ts`' }] }).thought).toBe(
      undefined,
    );
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

  it('marks a quiet Thinking line from the last output, never a step that is doing something', () => {
    expect(leadStep({ ...none, outputAt: 40 })).toEqual({
      label: 'Thinking',
      since: null,
      quietSince: 40,
    });
    const thinking = { name: 'Thinking', done: false, startedAt: 3 };
    expect(leadStep({ ...none, steps: [thinking], outputAt: 40 }).quietSince).toBe(40);
    const reading = { name: 'Read `a.ts`', done: false, startedAt: 5 };
    expect(leadStep({ ...none, steps: [reading], outputAt: 40 })).toEqual({
      label: 'Read a.ts',
      since: 5,
    });
    expect(leadStep({ ...none, commands: [command('running')], outputAt: 40 }).quietSince).toBe(
      undefined,
    );
    expect(leadStep(none)).toEqual({ label: 'Thinking', since: null });
  });

  it('names the Sparks the turn waits on when it has no step of its own', () => {
    expect(leadStep({ ...none, sparks: ['Docs'], outputAt: 40 })).toEqual({
      label: 'Waiting on Docs',
      since: null,
    });
    expect(leadStep({ ...none, sparks: ['Docs', 'Ops'] }).label).toBe('Waiting on Docs and Ops');
    expect(leadStep({ ...none, sparks: ['Docs', 'Ops', 'Scope'] }).label).toBe(
      'Waiting on 3 Sparks',
    );
    const reading = { name: 'Read `a.ts`', done: false, startedAt: 5 };
    expect(leadStep({ ...none, sparks: ['Docs'], steps: [reading] }).label).toBe('Read a.ts');
  });
});

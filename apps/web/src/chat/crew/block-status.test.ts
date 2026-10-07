import { describe, expect, it } from 'vitest';
import { runAgent } from '../../crew/crew-projection.ts';
import { checkpoint, member, orchestration } from '../../crew/test-orchestration.ts';
import { blockStatus } from './block-status.ts';

const idle = { steps: [], waiting: false, started: false };
const ROOT = orchestration().runId;
const BOLT = '00000000-0000-4000-8000-0000000000b1';

describe('blockStatus', () => {
  it('says thinking before the first step, then working once a reply starts', () => {
    const agent = runAgent(member({ status: 'running', toolCalls: 0 }), orchestration());
    expect(blockStatus(agent, idle)).toEqual({ state: 'thinking', label: 'thinking' });
    expect(blockStatus(agent, { ...idle, started: true })).toEqual({
      state: 'working',
      label: 'working',
    });
    const steps = [{ name: 'Read `a.ts`', done: true }];
    expect(blockStatus(agent, { ...idle, steps }).label).toBe('working');
  });

  it('names the open step in plain words', () => {
    const agent = runAgent(member({ status: 'running', toolCalls: 2 }), orchestration());
    const steps = [
      { name: 'Read `a.ts`', done: true },
      { name: 'Edit', done: false },
    ];
    expect(blockStatus(agent, { ...idle, steps })).toEqual({
      state: 'working',
      label: 'editing a file',
    });
    expect(
      blockStatus(agent, { ...idle, steps: [{ name: 'Edit `turns.ts`', done: false }] }),
    ).toEqual({ state: 'working', label: 'editing turns.ts' });
    expect(blockStatus(agent, { ...idle, steps: [steps[0]!] }).label).toBe('working');
  });

  it('waits for you on a pending card, whatever the run status says', () => {
    const running = runAgent(member({ status: 'running', toolCalls: 1 }), orchestration());
    const steps = [{ name: 'Edit `turns.ts`', done: false }];
    expect(blockStatus(running, { ...idle, steps, waiting: true })).toEqual({
      state: 'waiting',
      label: 'waiting for you',
    });
    const held = runAgent(member({ status: 'awaiting_approval' }), orchestration());
    expect(blockStatus(held, idle).label).toBe('waiting for you');
  });

  it('shows how a finished agent ended, never a working word', () => {
    const steps = [{ name: 'Edit `turns.ts`', done: false }];
    const ended = (status: 'succeeded' | 'failed' | 'cancelled') =>
      blockStatus(runAgent(member({ status }), orchestration()), {
        steps,
        waiting: true,
        started: true,
      });
    expect(ended('succeeded')).toEqual({ state: 'done', label: 'done' });
    expect(ended('failed')).toEqual({ state: 'failed', label: 'hit a problem' });
    expect(
      blockStatus(
        { state: 'failed' },
        { steps: [], waiting: false, started: true },
        'Approval timed out',
      ),
    ).toEqual({ state: 'stopped', label: 'waited for you' });
    expect(ended('cancelled')).toEqual({ state: 'stopped', label: 'stopped' });
  });

  it('says queued until the agent starts', () => {
    const agent = runAgent(member({ status: 'queued', startedAt: null }), orchestration());
    expect(blockStatus(agent, idle)).toEqual({ state: 'queued', label: 'queued' });
  });

  it("shows the turn's own agent as done once it has handed off, while a sibling still runs", () => {
    const reader = member({
      runId: ROOT,
      role: 'scout',
      name: 'Pip',
      status: 'running',
      toolCalls: null,
    });
    const builder = member({ runId: BOLT, name: 'Bolt', status: 'running', toolCalls: 3 });
    const alone = orchestration({ crew: [reader] });
    expect(blockStatus(runAgent(reader, alone), idle).label).toBe('thinking');

    const handedOff = orchestration({ crew: [reader, builder] });
    expect(blockStatus(runAgent(reader, handedOff), idle)).toEqual({
      state: 'done',
      label: 'done',
    });
    expect(blockStatus(runAgent(builder, handedOff), idle).label).toBe('working');

    const queued = orchestration({
      crew: [reader, { ...builder, status: 'queued', startedAt: null }],
    });
    expect(runAgent(reader, queued).state).toBe('thinking');
  });

  it('keeps a handed-off agent waiting while its own question card is open', () => {
    const reader = member({ runId: ROOT, role: 'scout', status: 'running' });
    const builder = member({ runId: BOLT, status: 'running' });
    const asking = orchestration({
      crew: [reader, builder],
      pendingCheckpoint: checkpoint({ kind: 'clarify' }, { runId: ROOT }),
    });
    expect(runAgent(reader, asking).state).toBe('waiting');
  });
});

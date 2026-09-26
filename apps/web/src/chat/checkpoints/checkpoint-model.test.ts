import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import { checkpoint } from '../../crew/test-orchestration.ts';
import { crewItems, mergeCheckpoints } from '../crew/crew-items.ts';
import { member } from '../../crew/test-orchestration.ts';
import {
  autoLabel,
  budgetLine,
  checkpointResult,
  checkpointTitle,
  isCheckpoint,
  retryLine,
  secondsLeft,
  waitingLabel,
} from './checkpoint-model.ts';

const opus = { provider: 'claude', model: 'opus-5.5', modelLabel: 'Opus 5.5', effort: 'high' };
const sonnet = { provider: 'claude', model: 'sonnet-5', modelLabel: 'Sonnet 5', effort: 'medium' };

describe('checkpoint wording', () => {
  it('suggests the escalated model for a retry', () => {
    const payload = checkpoint({ kind: 'retry', from: sonnet, to: opus }).payload.checkpoint!;
    expect(retryLine(payload)).toBe('Jev suggests retrying with Opus 5.5 · high.');
    expect(retryLine({ ...payload, to: sonnet })).toBe('Jev suggests retrying the step.');
  });

  it('names the agent that needs your input', () => {
    const payload = checkpoint({ kind: 'clarify', agent: 'Bolt' }).payload.checkpoint!;
    expect(checkpointTitle(payload)).toBe('Bolt needs your input');
    expect(waitingLabel(payload)).toBe('Answer Bolt');
    expect(checkpointTitle({ ...payload, agent: null })).toBe('Jev has a question');
  });

  it('counts down the default answer from the server deadline', () => {
    expect(autoLabel(CHECKPOINT_OPTION.finish, 10)).toBe('Skip (10s)');
    expect(autoLabel(CHECKPOINT_OPTION.clarifyRules, 3)).toBe('Continue (3s)');
    const at = '2026-09-26T10:00:10.000Z';
    expect(secondsLeft(at, Date.parse('2026-09-26T10:00:00.200Z'))).toBe(10);
    expect(secondsLeft(at, Date.parse('2026-09-26T10:00:11.000Z'))).toBe(0);
  });

  it('says when a question continued on its own', () => {
    const auto = checkpoint(
      { kind: 'retry' },
      {
        status: 'denied',
        decidedBy: 'auto',
        decisionOptionId: CHECKPOINT_OPTION.finish,
        createdAt: '2026-09-26T10:00:00.000Z',
        autoContinueAt: '2026-09-26T10:00:10.000Z',
      },
    );
    expect(checkpointResult(auto)).toBe('Continued automatically after 10s.');
  });

  it('describes the budget that ran out', () => {
    const payload = checkpoint({
      kind: 'budget',
      budget: { limit: 'time', used: 900_000, allowed: 900_000 },
    }).payload.checkpoint!;
    expect(budgetLine(payload)).toBe('Used 15m of 15m · active time');
  });

  it('reads back the decision', () => {
    const clarify = checkpoint(
      { kind: 'clarify', choices: ['Local time', 'UTC'] },
      { status: 'allowed', decisionOptionId: 'option:1' },
    );
    expect(checkpointResult(clarify)).toBe('You chose: UTC');
    const plan = checkpoint({ kind: 'plan' }, { status: 'allowed', decisionOptionId: 'edit' });
    expect(checkpointResult(plan)).toBe('Sent your changes to the plan.');
    expect(checkpointResult(checkpoint({ kind: 'plan' }, { status: 'expired' }))).toBe(
      'Expired before you answered.',
    );
  });
});

describe('checkpoints in the turn', () => {
  it('keeps the decided copy of a checkpoint and ignores tool approvals', () => {
    const pending = checkpoint({ kind: 'plan' });
    const decided = { ...pending, status: 'allowed' as const, decisionOptionId: 'approve' };
    const tool = {
      ...pending,
      id: '00000000-0000-4000-8000-0000000000c9',
      kind: 'execute' as const,
    };
    const merged = mergeCheckpoints([decided], [pending, tool]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.status).toBe('allowed');
    expect(isCheckpoint(tool)).toBe(false);
  });

  it('places run-level checkpoints between the agents by time', () => {
    const scout = member({ runId: '00000000-0000-4000-8000-0000000000b1', role: 'scout' });
    const builder = member({ startedAt: '2026-09-26T10:04:00.000Z' });
    const queued = member({
      runId: '00000000-0000-4000-8000-0000000000b3',
      role: 'critic',
      startedAt: null,
      status: 'queued',
    });
    const plan = checkpoint({ kind: 'plan' }, { createdAt: '2026-09-26T10:03:30.000Z' });
    const own = checkpoint({ kind: 'accept' }, { id: 'x', runId: builder.runId });
    const items = crewItems([scout, builder, queued], mergeCheckpoints([plan, own]));
    expect(items.map((item) => item.kind)).toEqual(['agent', 'checkpoint', 'agent', 'agent']);
    expect(items[2]).toMatchObject({ kind: 'agent', checkpoints: [own] });
  });
});

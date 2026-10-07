import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHECKPOINT_OPTION,
  checkpointPayloadSchema,
  type ApprovalOption,
  type CheckpointKind,
} from '@spark-outpost/contracts';
import { getApproval, insertApproval, type NewApproval } from '../src/persistence/approvals.ts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { claimNextJob } from '../src/persistence/jobs.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { WAITING_OUTCOME_MESSAGE, recoverExpiredLeases } from '../src/workflow/recovery.ts';
import { seedConversation, seedTask, seedTurn } from './outcome-seed.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

const allow = (optionId: string, name: string): ApprovalOption => ({
  optionId,
  name,
  kind: 'allow_once',
});
const reject = (optionId: string, name: string): ApprovalOption => ({
  optionId,
  name,
  kind: 'reject_once',
});

const SONNET = { provider: 'claude', model: 'sonnet', modelLabel: 'Sonnet 5', effort: 'medium' };
const OPUS = { provider: 'claude', model: 'opus[1m]', modelLabel: 'Opus 5.5', effort: 'high' };

interface OldCard {
  kind: CheckpointKind;
  title: string;
  checkpoint: Record<string, unknown>;
  options: ApprovalOption[];
  decision: string;
  status: 'allowed' | 'denied';
}

const OLD_CARDS: readonly OldCard[] = [
  {
    kind: 'plan',
    title: 'Build this plan?',
    checkpoint: {
      question: 'Build this plan?',
      reason: 'The plan is ready.',
      plan: [
        { content: 'Move the date helpers into one module', priority: 'high', status: 'pending' },
        { content: 'Update the callers', priority: 'medium', status: 'pending' },
      ],
      planVersion: 1,
      estimate: 'About 4 min',
    },
    options: [
      allow(CHECKPOINT_OPTION.approvePlan, 'Build'),
      allow(CHECKPOINT_OPTION.editPlan, 'Edit'),
      reject(CHECKPOINT_OPTION.stop, 'Stop'),
    ],
    decision: CHECKPOINT_OPTION.approvePlan,
    status: 'allowed',
  },
  {
    kind: 'clarify',
    title: 'Spark has a few questions',
    checkpoint: {
      question: 'Which date helpers should move?',
      reason: 'The request can be read more than one way.',
      questions: [
        {
          question: 'Which date helpers should move?',
          options: ['All of them', 'Only the formatters'],
          default: 'All of them',
        },
      ],
    },
    options: [
      allow(CHECKPOINT_OPTION.answer, 'Answer'),
      allow(CHECKPOINT_OPTION.useDefaults, 'Use defaults'),
      reject(CHECKPOINT_OPTION.stop, 'Stop'),
    ],
    decision: CHECKPOINT_OPTION.useDefaults,
    status: 'allowed',
  },
  {
    kind: 'retry',
    title: 'Retry with Opus 5.5?',
    checkpoint: {
      question: 'Retry with Opus 5.5?',
      reason: 'The Builder failed twice.',
      from: SONNET,
      to: OPUS,
      autoOption: CHECKPOINT_OPTION.stopReport,
    },
    options: [
      allow(CHECKPOINT_OPTION.retry, 'Retry'),
      reject(CHECKPOINT_OPTION.stopReport, 'Stop and report'),
    ],
    decision: CHECKPOINT_OPTION.stopReport,
    status: 'denied',
  },
  {
    kind: 'verify',
    title: 'Jev could not verify the change',
    checkpoint: {
      question: 'Finish as it is, or retry with Opus 5.5?',
      reason: 'Jev could not confirm the change does what was asked.',
      from: SONNET,
      to: OPUS,
      autoOption: CHECKPOINT_OPTION.finishUnverified,
    },
    options: [
      allow(CHECKPOINT_OPTION.finishUnverified, 'Finish as it is'),
      allow(CHECKPOINT_OPTION.retry, 'Retry one tier up'),
      reject(CHECKPOINT_OPTION.stop, 'Stop'),
    ],
    decision: CHECKPOINT_OPTION.finishUnverified,
    status: 'allowed',
  },
  {
    kind: 'pr_split',
    title: 'One PR or separate PRs?',
    checkpoint: {
      question: 'P1, P2 were built in their own worktrees. Ship them in one PR, or one PR each?',
      reason: 'Each piece has its own branch.',
      autoOption: CHECKPOINT_OPTION.onePr,
    },
    options: [
      allow(CHECKPOINT_OPTION.onePr, 'One PR'),
      allow(CHECKPOINT_OPTION.separatePrs, 'Separate PRs'),
      allow(CHECKPOINT_OPTION.alwaysOnePr, 'Always one PR here'),
      allow(CHECKPOINT_OPTION.alwaysSeparatePrs, 'Always separate PRs here'),
    ],
    decision: CHECKPOINT_OPTION.separatePrs,
    status: 'allowed',
  },
];

function stored(card: OldCard, runId: string): NewApproval {
  return {
    runId,
    toolCallId: `checkpoint:${card.kind}:${randomUUID()}`,
    rpcId: null,
    kind: card.kind,
    title: card.title,
    payload: {
      command: null,
      cwd: null,
      paths: [],
      diffs: [],
      truncated: false,
      checkpoint: checkpointPayloadSchema.parse({ kind: card.kind, ...card.checkpoint }),
    },
    options: card.options,
    reason: null,
  };
}

describe('cards Spark no longer raises, stored by an earlier version', () => {
  it('still shows each decided card in the chat and in its turn with kind, title, options and decision', async () => {
    const conversationId = await seedConversation(t.db, t.workspaceId);
    const taskId = await seedTask(t.db, conversationId);
    const runId = await seedTurn(t.db, conversationId, { taskId, status: 'succeeded' });
    for (const card of OLD_CARDS) {
      await insertApproval(t.db, stored(card, runId), {
        status: card.status,
        decidedBy: 'user',
        optionId: card.decision,
      });
    }
    const expected = OLD_CARDS.map((card) => ({
      runId,
      kind: card.kind,
      title: card.title,
      options: card.options,
      status: card.status,
      decisionOptionId: card.decision,
      decidedBy: 'user',
      scope: 'once',
      payload: {
        checkpoint: checkpointPayloadSchema.parse({ kind: card.kind, ...card.checkpoint }),
      },
    }));

    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail!.approvals).toHaveLength(OLD_CARDS.length);
    expect(detail!.approvals).toMatchObject(expected);
    expect(detail!.approvals.every((approval) => approval.decidedAt !== null)).toBe(true);

    const orchestration = await loadOrchestration(t.db, runId);
    expect(orchestration!.checkpoints).toHaveLength(OLD_CARDS.length);
    expect(orchestration!.checkpoints).toMatchObject(expected);
    expect(orchestration!.pendingCheckpoint).toBeNull();
    expect(detail!.orchestrations?.[runId]?.checkpoints.map((card) => card.kind)).toEqual(
      OLD_CARDS.map((card) => card.kind),
    );
  });

  it('ends a run the worker left waiting on a plan card as outcome unknown and expires the card', async () => {
    const conversationId = await seedConversation(t.db, t.workspaceId);
    const sent = await sendUserMessage(
      t.db,
      conversationId,
      { id: randomUUID(), content: 'Move the date helpers into one module' },
      { provider: 'fake', permission: 'do', level: 'hands-off' },
    );
    const runId = sent.run.id;
    const lease = (await claimNextJob(t.db, 30))!;
    expect(lease.runId).toBe(runId);
    const card = await insertApproval(t.db, stored(OLD_CARDS[0]!, runId));
    expect(card).toMatchObject({ kind: 'plan', status: 'pending' });
    await t.db.query(`UPDATE runs SET status = 'awaiting_approval' WHERE id = $1`, [runId]);
    await t.db.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second'`);

    expect(await recoverExpiredLeases(t.db)).toBe(1);
    expect(await getRun(t.db, runId)).toMatchObject({
      status: 'outcome_unknown',
      error: WAITING_OUTCOME_MESSAGE,
    });
    expect(await getApproval(t.db, card.id)).toMatchObject({
      kind: 'plan',
      title: 'Build this plan?',
      status: 'expired',
      decidedBy: 'recovery',
      decisionOptionId: null,
    });
    expect(await recoverExpiredLeases(t.db)).toBe(0);
  });
});

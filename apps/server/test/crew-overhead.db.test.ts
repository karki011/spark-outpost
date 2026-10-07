import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PIECE_LIMITS } from '@spark-outpost/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PIECE_PLAN_REASON } from '../src/workflow/approval-gate.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { insertPlanDocument } from '../src/persistence/plan-documents.ts';
import { children, pieceList } from './coordinator-support.ts';
import { FAKE_PIECES_PLAN, PIECE_CHECK_SCRIPT } from './fake-acp-coordinator.ts';
import {
  NORMAL,
  RISKY,
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  withTag,
  type Harness,
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness | null = null;
let script: JevScript;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await writeFile(join(root, 'piece-check.mjs'), PIECE_CHECK_SCRIPT);
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

interface ParallelAnswer {
  engage: boolean;
  planBuilt: boolean;
  planItems: number;
  solo: string | null;
}

async function parallelAnswer(runId: string): Promise<ParallelAnswer | null> {
  const { rows } = await t.db.query<{ answer: ParallelAnswer }>(
    `SELECT body->'answer' AS answer FROM run_advice
     WHERE run_id = $1 AND purpose = 'parallel'`,
    [runId],
  );
  return rows[0]?.answer ?? null;
}

async function approvedPlan(conversationId: string): Promise<void> {
  await insertPlanDocument(t.db, {
    conversationId,
    taskId: null,
    source: 'chat',
    body: `# Plan\n\n${FAKE_PIECES_PLAN}`,
    sourceRunId: null,
    approval: { by: 'user', option: null, runId: null, commit: null },
  });
}

async function startPlanned(scenario: Scenario) {
  script = { calls: [], scenario: NORMAL };
  harness = startOrchestrator(t, jevFetch(script), {
    coordinator: 'in_order',
  });
  return startScenario(
    t,
    root,
    scenario,
    'hands-off',
    'auto',
    'sonnet',
    'acceptEdits',
    approvedPlan,
  );
}

async function followUp(conversationId: string, content: string): Promise<string> {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    {
      provider: 'claude',
      model: 'sonnet',
      effort: 'medium',
      permission: 'do',
      agentMode: 'acceptEdits',
      level: 'hands-off',
    },
  );
  return sent.run.id;
}

describe('Coordinator overhead', { timeout: 180_000 }, () => {
  it('accepts a list whose goal is over the limit on the first try, and leaves a built plan out of the next turn', async () => {
    const first = await startPlanned(withTag(NORMAL, 'Split this up. #pieces #longgoal'));
    const built = await driveToEnd(t, first.conversationId, first.runId, undefined, 120_000);
    expect(built.orchestration.status).toBe('succeeded');
    const crew = await children(t, first.runId);
    expect(crew.filter((child) => child.role === 'coordinator')).toHaveLength(1);
    expect(crew[0]!.prompt).toContain(`goal at most ${PIECE_LIMITS.goal};`);
    const list = await pieceList(t, first.runId);
    expect(list.pieces.map((piece) => piece.status)).toEqual(['landed', 'landed', 'landed']);
    expect(list.pieces[0]!.goal.length).toBeLessThanOrEqual(PIECE_LIMITS.goal);
    expect(list.pieces[0]!.goal.endsWith('…')).toBe(true);
    expect(await parallelAnswer(first.runId)).toMatchObject({
      engage: true,
      planBuilt: false,
      planItems: 3,
      solo: null,
    });

    script.scenario = { ...NORMAL, continuesTask: 0.02 };
    const secondRun = await followUp(first.conversationId, 'cap 3 → 8 #build');
    const second = await driveToEnd(t, first.conversationId, secondRun, undefined, 120_000);
    expect(second.orchestration.status).toBe('succeeded');
    const roles = (await children(t, secondRun)).map((child) => child.role);
    expect(roles).toContain('builder');
    expect(roles).not.toContain('coordinator');
    expect(await parallelAnswer(secondRun)).toMatchObject({
      engage: false,
      planBuilt: true,
      planItems: 0,
      solo: null,
    });
  });

  it('lets a piece Builder leave plan mode without a plan card or a plan document', async () => {
    const { conversationId, runId } = await startPlanned(
      withTag(NORMAL, 'Split this up. #pieces #pieceplans'),
    );
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, undefined, 120_000);
    expect(orchestration.status).toBe('succeeded');
    expect(asked.map((approval) => approval.title)).not.toContain('Approve Plan');
    const list = await pieceList(t, runId);
    expect(list.pieces.map((piece) => piece.status)).toEqual(['landed', 'landed', 'landed']);
    const { rows: plans } = await t.db.query<{ id: string }>(
      `SELECT d.id FROM plan_documents d JOIN runs r ON r.id = d.source_run_id
       WHERE r.parent_run_id = $1`,
      [runId],
    );
    expect(plans).toEqual([]);
    const { rows: notes } = await t.db.query<{ name: string }>(
      `SELECT e.payload->>'stepName' AS name FROM run_events e JOIN runs r ON r.id = e.run_id
       WHERE r.parent_run_id = $1 AND e.type = 'STEP_STARTED'
         AND e.payload->>'stepName' LIKE 'Left plan mode%'`,
      [runId],
    );
    expect(notes.map((note) => note.name)).toEqual([expect.stringContaining(PIECE_PLAN_REASON)]);
  });
});

describe('Critic that fails or goes quiet', { timeout: 180_000 }, () => {
  async function review(tag: string, criticQuietNoticeMs?: number) {
    harness = startOrchestrator(t, jevFetch({ calls: [], scenario: RISKY }), {
      ...(criticQuietNoticeMs ? { criticQuietNoticeMs } : {}),
    });
    const { conversationId, runId } = await startScenario(
      t,
      root,
      withTag(RISKY, tag),
      'hands-off',
    );
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 120_000);
    const critics = (await children(t, runId)).filter((child) => child.role === 'critic');
    const reply = (await assistantReplies(t, runId)).at(-1) ?? '';
    return { orchestration, critics, reply, runId };
  }

  it('moves to the other provider at once when the first Critic prompt fails', async () => {
    const { orchestration, critics, reply } = await review('#codexcriticdown');
    expect(orchestration.status).toBe('succeeded');
    expect(critics.map((critic) => [critic.provider, critic.status])).toEqual([
      ['codex', 'failed'],
      ['claude', 'succeeded'],
    ]);
    expect(critics[0]!.error).toContain('Codex reported an error');
    expect(reply).not.toContain('Review skipped');
    const { rows } = await t.db.query<{ note: string | null }>(
      `SELECT route->>'routeNote' AS note FROM runs WHERE id = $1`,
      [critics[1]!.id],
    );
    expect(rows[0]!.note).toBe('reviewing instead of Codex, whose review did not finish');
  });

  it('notes a quiet Critic without stopping it, and the review still lands', async () => {
    const { orchestration, critics, reply, runId } = await review('#criticquiet', 500);
    expect(orchestration.status).toBe('succeeded');
    expect(critics.map((critic) => [critic.provider, critic.status])).toEqual([
      ['codex', 'succeeded'],
    ]);
    expect(reply).not.toContain('Review skipped');
    const { rows } = await t.db.query<{ name: string }>(
      `SELECT payload->>'stepName' AS name FROM run_events
       WHERE run_id = $1 AND type = 'STEP_STARTED' AND payload->>'stepName' LIKE '%no progress%'`,
      [runId],
    );
    expect(rows.map((row) => row.name)).toEqual([
      expect.stringMatching(/^\w+ has shown no progress for 1 minute; still waiting$/),
    ]);
  });
});

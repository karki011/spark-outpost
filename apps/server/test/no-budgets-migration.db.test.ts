import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { approvalSchema, orchestrationSchema } from '@spark-outpost/contracts';
import { getApproval } from '../src/persistence/approvals.ts';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import type { Db } from '../src/persistence/db.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getSetupState } from '../src/persistence/setup.ts';
import { migratedUpTo, oldConversation } from './migration-support.ts';

const NO_BUDGETS_MIGRATION = '0134_no_budgets.sql';

async function oldBudgetedRun(db: Db, conversationId: string): Promise<string> {
  const runId = randomUUID();
  const messageId = randomUUID();
  await db.query(
    `INSERT INTO messages (id, conversation_id, role, content)
     VALUES ($1, $2, 'user', 'Tidy the notes')`,
    [messageId, conversationId],
  );
  await db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, mode)
     VALUES ($1, $2, $3, 'claude', 'awaiting_approval', 'do')`,
    [runId, conversationId, messageId],
  );
  await db.query(
    `INSERT INTO orchestrations (run_id, phase, depth, depth_source, risk, routing,
       active_ms, tool_calls, active_limit_ms, tool_call_limit, cost_cap_usd, exceeded)
     VALUES ($1, 'building', 'execute', 'rules', 'edits', 'auto', 90000, 60, 900000, 60, 2.5,
       'tool_calls')`,
    [runId],
  );
  return runId;
}

async function oldBudgetCard(db: Db, runId: string, status: 'pending' | 'denied'): Promise<string> {
  const id = randomUUID();
  const payload = {
    command: null,
    cwd: null,
    paths: [],
    diffs: [],
    truncated: false,
    checkpoint: {
      kind: 'budget',
      question: 'Continue past the budget?',
      reason: 'The tool calls budget ran out.',
      budget: { limit: 'tool_calls', used: 60, allowed: 60 },
    },
  };
  const options = [
    { optionId: 'continue', name: 'Continue', kind: 'allow_once' },
    { optionId: 'stop', name: 'Stop', kind: 'reject_once' },
  ];
  const decided = status === 'denied';
  await db.query(
    `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
       status, reason, decision_option_id, scope, decided_by, decided_at)
     VALUES ($1, $2, $3, 'budget', 'Continue past the budget?', $4, 'sha256:old', $5, $6,
       'The tool calls budget ran out.', $7, $8, $9, $10)`,
    [
      id,
      runId,
      `checkpoint:budget:${id}`,
      JSON.stringify(payload),
      JSON.stringify(options),
      status,
      decided ? 'stop' : null,
      decided ? 'once' : null,
      decided ? 'user' : null,
      decided ? new Date() : null,
    ],
  );
  return id;
}

describe('upgrading to no run budgets', () => {
  const state = migratedUpTo(NO_BUDGETS_MIGRATION);

  it('answers a waiting budget card as Continue and keeps old cards readable', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    const chat = await oldConversation(db, workspaceId);
    const runId = await oldBudgetedRun(db, chat.id);
    const waiting = await oldBudgetCard(db, runId, 'pending');
    const stopped = await oldBudgetCard(db, runId, 'denied');

    await runMigrations(db);

    const continued = await getApproval(db, waiting);
    expect(continued).toMatchObject({
      kind: 'budget',
      status: 'allowed',
      decisionOptionId: 'continue',
      decidedBy: 'policy',
    });
    expect(await getApproval(db, stopped)).toMatchObject({
      status: 'denied',
      decisionOptionId: 'stop',
      decidedBy: 'user',
    });
    const parsed = approvalSchema.parse(continued);
    expect(parsed.payload.checkpoint).not.toHaveProperty('budget');
    const { rows } = await db.query(`SELECT 1 FROM approvals WHERE status = 'pending'`);
    expect(rows).toEqual([]);
  });

  it('keeps the measured usage of old runs and drops the limits and the spend cap', async () => {
    const { db } = state;
    const workspaceId = await ensureLocalWorkspace(db);
    await db.query(
      `INSERT INTO profiles (workspace_id, spend_cap_usd) VALUES ($1, 2.5)
       ON CONFLICT (workspace_id) DO UPDATE SET spend_cap_usd = 2.5`,
      [workspaceId],
    );
    const chat = await oldConversation(db, workspaceId);
    const runId = await oldBudgetedRun(db, chat.id);

    await runMigrations(db);

    const orchestration = await loadOrchestration(db, runId);
    expect(orchestration?.usage).toEqual({ activeMs: 90_000, toolCalls: 60, costUsd: 0 });
    expect(orchestrationSchema.parse(orchestration)).not.toHaveProperty('budget');
    expect((await getSetupState(db, workspaceId)).profile).not.toHaveProperty('spendCapUsd');
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name IN ('orchestrations', 'profiles')
         AND column_name IN ('active_limit_ms', 'tool_call_limit', 'cost_cap_usd', 'exceeded',
           'spend_cap_usd')`,
      [state.schema],
    );
    expect(rows).toEqual([]);
  });
});

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ensureLocalWorkspace } from '../src/persistence/conversations.ts';
import type { Db } from '../src/persistence/db.ts';
import { runMigrations } from '../src/persistence/migrate.ts';
import { migratedUpTo, oldConversation } from './migration-support.ts';

const RUN_TODO_MIGRATION = '0207_run_todo.sql';

const entries = (...statuses: string[]) =>
  statuses.map((status, index) => ({ content: `Step ${index + 1}`, priority: 'medium', status }));

async function oldRun(db: Db, conversationId: string, taskId: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO runs (id, conversation_id, provider, status, task_id)
     VALUES ($1, $2, 'claude', 'succeeded', $3)`,
    [id, conversationId, taskId],
  );
  return id;
}

async function sentPlan(db: Db, runId: string, seq: number, list: unknown[]): Promise<void> {
  await db.query(
    `INSERT INTO run_events (run_id, seq, type, payload) VALUES ($1, $2, 'ACTIVITY_SNAPSHOT', $3)`,
    [
      runId,
      seq,
      JSON.stringify({
        type: 'ACTIVITY_SNAPSHOT',
        messageId: 'artifact:plan',
        activityType: 'plan',
        content: { version: 1, body: { entries: list } },
        replace: true,
      }),
    ],
  );
}

async function todoOf(db: Db, runId: string): Promise<unknown> {
  const { rows } = await db.query<{ todo: unknown }>('SELECT todo FROM runs WHERE id = $1', [
    runId,
  ]);
  return rows[0]?.todo;
}

describe('upgrading to one to-do per run', () => {
  const state = migratedUpTo(RUN_TODO_MIGRATION);

  it('gives each run the list it sent, even after a later run took over the stored version', async () => {
    const workspaceId = await ensureLocalWorkspace(state.db);
    const { id: conversationId } = await oldConversation(state.db, workspaceId);
    const taskId = randomUUID();
    await state.db.query(`INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, 'T')`, [
      taskId,
      conversationId,
    ]);
    const first = await oldRun(state.db, conversationId, taskId);
    const second = await oldRun(state.db, conversationId, taskId);
    const quiet = await oldRun(state.db, conversationId, taskId);
    const silent = await oldRun(state.db, conversationId, taskId);
    await sentPlan(state.db, first, 1, entries('in_progress', 'pending'));
    await sentPlan(state.db, first, 2, entries('completed', 'in_progress'));
    await sentPlan(state.db, second, 1, entries('completed', 'completed'));
    await state.db.query(
      `INSERT INTO run_artifacts (task_id, kind, version, body, source_run_id)
       VALUES ($1, 'plan', 1, $2, $3), ($1, 'plan', 2, $4, $5)`,
      [
        taskId,
        JSON.stringify({ entries: entries('completed', 'completed') }),
        second,
        JSON.stringify({ entries: entries('pending') }),
        quiet,
      ],
    );

    await runMigrations(state.db);

    expect(await todoOf(state.db, first)).toEqual(entries('completed', 'in_progress'));
    expect(await todoOf(state.db, second)).toEqual(entries('completed', 'completed'));
    expect(await todoOf(state.db, quiet)).toEqual(entries('pending'));
    expect(await todoOf(state.db, silent)).toBeNull();
  });
});

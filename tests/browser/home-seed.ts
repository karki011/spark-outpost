import { randomUUID } from 'node:crypto';
import { createDb } from '../../apps/server/src/persistence/db.ts';
import { testDatabaseUrl } from './database.ts';

export interface RunDetails {
  provider?: string;
  model?: string;
  step?: string;
  plan?: string[];
  costUsd?: number;
  costSource?: 'reported' | 'estimated';
  input?: number;
  output?: number;
  routedByJev?: boolean;
  jevCostUsd?: number;
}

export async function decorateLatestRun(conversationId: string, details: RunDetails) {
  const db = createDb(testDatabaseUrl());
  try {
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM runs WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
      [conversationId],
    );
    const runId = rows[0]!.id;
    const input = details.input ?? null;
    const output = details.output ?? null;
    await db.query(
      `UPDATE runs SET provider = COALESCE($2, provider), model = $3, cost_usd = $4,
         cost_source = $5, input_tokens = $6, output_tokens = $7,
         total_tokens = $6::int + $7::int, route = $8
       WHERE id = $1`,
      [
        runId,
        details.provider ?? null,
        details.model ?? null,
        details.costUsd ?? null,
        details.costUsd === undefined ? null : (details.costSource ?? 'reported'),
        input,
        output,
        details.routedByJev
          ? JSON.stringify({ name: 'Ada', routedBy: 'jev', modelLabel: null })
          : null,
      ],
    );
    if (details.jevCostUsd !== undefined) {
      await db.query(
        `INSERT INTO run_advice (run_id, purpose, jev_status, jev_input_tokens, jev_cost_usd, body)
         VALUES ($1, 'route', 'answered', 900, $2, '{}')`,
        [runId, details.jevCostUsd],
      );
    }
    if (details.step) {
      const started = { type: 'STEP_STARTED', stepName: details.step };
      await db.query(
        `INSERT INTO run_events (run_id, seq, type, payload)
         VALUES ($1, (SELECT COALESCE(max(seq), 0) + 1 FROM run_events WHERE run_id = $1), $2, $3)`,
        [runId, started.type, JSON.stringify(started)],
      );
    }
    if (details.plan) {
      const taskId = randomUUID();
      await db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
        taskId,
        conversationId,
        'Plan',
      ]);
      await db.query('UPDATE runs SET task_id = $2 WHERE id = $1', [runId, taskId]);
      const entries = details.plan.map((status, index) => ({
        content: `Step ${index + 1}`,
        priority: 'medium',
        status,
      }));
      await db.query(
        `INSERT INTO run_artifacts (task_id, kind, version, body, source_run_id)
         VALUES ($1, 'plan', 1, $2, $3)`,
        [taskId, JSON.stringify({ entries }), runId],
      );
    }
  } finally {
    await db.end();
  }
}

export async function markVerifyFailed(provider: string, message: string) {
  const db = createDb(testDatabaseUrl());
  try {
    await db.query(
      `UPDATE provider_connections
       SET last_test_at = now(), last_test_ok = false, last_test_message = $2
       WHERE provider = $1`,
      [provider, message],
    );
  } finally {
    await db.end();
  }
}

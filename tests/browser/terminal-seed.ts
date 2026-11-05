import { randomUUID } from 'node:crypto';
import { openTestDb } from './database.ts';

export interface SeedTerminalStep {
  name: string;
  agentId?: string;
  open?: boolean;
}

export interface SeedTerminal {
  state: string;
  provider?: 'claude' | 'codex';
  cwd?: string;
  turn?: {
    status: string;
    model?: string;
    costUsd?: number;
    steps?: SeedTerminalStep[];
  };
}

export async function seedTerminal(conversationId: string, seed: SeedTerminal): Promise<void> {
  const db = openTestDb();
  try {
    const provider = seed.provider ?? 'claude';
    await db.query(`UPDATE conversations SET session_type = 'terminal' WHERE id = $1`, [
      conversationId,
    ]);
    await db.query(
      `INSERT INTO native_terminal_sessions (id, conversation_id, provider, state, cwd, label,
         observation)
       VALUES ($1, $2, $3, $4, $5, 'my files', 'hooks')`,
      [randomUUID(), conversationId, provider, seed.state, seed.cwd ?? '/Users/ada/code/importer'],
    );
    if (!seed.turn) return;
    const runId = randomUUID();
    const finished = !['queued', 'running', 'awaiting_approval'].includes(seed.turn.status);
    await db.query(
      `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, used_model,
         cost_usd, cost_source, started_at, finished_at)
       SELECT $1, $2, m.id, $3, $4, $5, $6, 'estimated', now(), CASE WHEN $7 THEN now() END
       FROM messages m WHERE m.conversation_id = $2 ORDER BY m.created_at LIMIT 1`,
      [
        runId,
        conversationId,
        provider,
        seed.turn.status,
        seed.turn.model ?? null,
        seed.turn.costUsd ?? null,
        finished,
      ],
    );
    for (const [index, step] of (seed.turn.steps ?? []).entries()) {
      await db.query(
        `INSERT INTO native_terminal_steps (run_id, tool_use_id, name, agent_id, started_at,
           ended_at)
         VALUES ($1, $2, $3, $4, now() - interval '1 minute' + $5 * interval '1 second',
           CASE WHEN $6 THEN NULL ELSE now() END)`,
        [runId, `seed-${index}`, step.name, step.agentId ?? null, index, step.open ?? false],
      );
    }
  } finally {
    await db.end();
  }
}

export async function setTerminalState(conversationId: string, state: string): Promise<void> {
  const db = openTestDb();
  try {
    await db.query(
      `UPDATE native_terminal_sessions SET state = $2, updated_at = now()
       WHERE conversation_id = $1`,
      [conversationId, state],
    );
    await db.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [conversationId]);
    if (state !== 'ready') return;
    await db.query(
      `UPDATE runs SET status = 'succeeded', finished_at = now()
       WHERE conversation_id = $1 AND status = 'running'`,
      [conversationId],
    );
    await db.query(
      `UPDATE native_terminal_steps SET ended_at = now()
       WHERE ended_at IS NULL AND run_id IN (SELECT id FROM runs WHERE conversation_id = $1)`,
      [conversationId],
    );
  } finally {
    await db.end();
  }
}

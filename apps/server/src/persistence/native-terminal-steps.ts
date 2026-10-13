import { friendlyStep, type ActivityStep, type NativeTerminalStep } from '@spark-outpost/contracts';
import { redactText, storableText } from '../audit/redact.ts';
import type { Db, Queryable } from './db.ts';

export interface NativeStepEvent {
  id: string;
  name: string;
  phase: 'start' | 'end';
  failed: boolean;
  agentId?: string;
}

interface StepRow {
  run_id: string;
  tool_use_id: string;
  name: string;
  agent_id: string | null;
  started_at: Date | null;
  ended_at: Date | null;
  failed: boolean;
}

export const storedLabel = (text: string) => redactText(storableText(text)).slice(0, 200);

export async function recordNativeStep(
  db: Db,
  runId: string,
  step: NativeStepEvent,
): Promise<void> {
  const values = [
    runId,
    storedLabel(step.id),
    storedLabel(step.name),
    step.agentId === undefined ? null : storedLabel(step.agentId),
  ];
  if (step.phase === 'start') {
    await db.query(
      `INSERT INTO native_terminal_steps (run_id, tool_use_id, name, agent_id, started_at)
       VALUES ($1, $2, $3, $4, now()) ON CONFLICT (run_id, tool_use_id) DO NOTHING`,
      values,
    );
    return;
  }
  await db.query(
    `INSERT INTO native_terminal_steps (run_id, tool_use_id, name, agent_id, ended_at, failed)
     VALUES ($1, $2, $3, $4, now(), $5)
     ON CONFLICT (run_id, tool_use_id) DO UPDATE SET
       ended_at = COALESCE(native_terminal_steps.ended_at, EXCLUDED.ended_at),
       failed = native_terminal_steps.failed OR EXCLUDED.failed`,
    [...values, step.failed],
  );
}

async function stepRows(db: Queryable, conversationId: string): Promise<StepRow[]> {
  const { rows } = await db.query<StepRow>(
    `SELECT s.* FROM native_terminal_steps s JOIN runs r ON r.id = s.run_id
     WHERE r.conversation_id = $1
     ORDER BY r.created_at, COALESCE(s.started_at, s.ended_at), s.tool_use_id`,
    [conversationId],
  );
  return rows;
}

export async function nativeStepsByRun(
  db: Queryable,
  conversationId: string,
): Promise<Map<string, NativeTerminalStep[]>> {
  const byRun = new Map<string, NativeTerminalStep[]>();
  for (const row of await stepRows(db, conversationId)) {
    const steps = byRun.get(row.run_id) ?? [];
    steps.push({
      id: row.tool_use_id,
      name: row.name,
      agentId: row.agent_id,
      startedAt: row.started_at?.toISOString() ?? null,
      endedAt: row.ended_at?.toISOString() ?? null,
      failed: row.failed,
    });
    byRun.set(row.run_id, steps);
  }
  return byRun;
}

export async function nativeStepActivity(
  db: Queryable,
  conversationId: string,
): Promise<Record<string, ActivityStep[]>> {
  const activity: Record<string, ActivityStep[]> = {};
  for (const [runId, steps] of await nativeStepsByRun(db, conversationId))
    activity[runId] = steps.map((step) => ({
      name: friendlyStep(step.name),
      done: step.endedAt !== null,
      ...(step.agentId ? { subagent: true } : {}),
    }));
  return activity;
}

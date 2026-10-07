import type { Db } from '../persistence/db.ts';
import { STEP_NOT_INTERRUPTED } from '../persistence/run-events.ts';
import type { ProtocolObserver, ProviderOutput, SessionTarget } from '../providers/provider.ts';
import { runChanges } from '../projects/run-changes.ts';
import type { RunInput } from './run-input.ts';
import { shownFiles } from './session-decision.ts';

const STEP_NAME_MAX = 200;
const WAITING_SHOWN = 5;

export interface LastStep {
  name: string;
  finished: boolean;
}

export interface InterruptionFacts {
  request: string;
  stoppedAt: Date | null;
  lastStep: LastStep | null;
  files: readonly string[];
  waitingFor: readonly string[];
}

function stepLine(step: LastStep | null): string {
  if (!step) return 'Last known step: none was recorded.';
  const name = step.name.slice(0, STEP_NAME_MAX);
  return step.finished
    ? `Last known step: "${name}", which had finished.`
    : `Last known step: "${name}", which had started and may not have finished.`;
}

function filesLine(files: readonly string[]): string {
  const shown = shownFiles(files);
  return shown.length > 0
    ? `Files changed so far: ${shown.join(', ')}.`
    : 'Files changed so far: none that Spark could see.';
}

function waitingLine(waitingFor: readonly string[]): string | null {
  if (waitingFor.length === 0) return null;
  const shown = waitingFor.slice(0, WAITING_SHOWN).map((title) => `"${title}"`);
  return `It was waiting for approval of ${shown.join(', ')}. That never ran and is not approved.`;
}

export function interruptionNote(facts: InterruptionFacts): string {
  const when = facts.stoppedAt ? ` (recorded at ${facts.stoppedAt.toISOString()})` : '';
  const state = [stepLine(facts.lastStep), filesLine(facts.files), waitingLine(facts.waitingFor)];
  return [
    '## Your previous turn was interrupted',
    `Spark Outpost stopped while you were working${when}, so that turn never finished. The user asked you to continue from here. Nothing was retried automatically.`,
    `Original request:\n${facts.request}`,
    state.filter((line) => line !== null).join('\n'),
    [
      'Before you go on:',
      '- Check the state of anything half-done before repeating it. Do not rerun commands blindly: a command may have finished, partly run or never started.',
      '- If you were pushing a branch or opening or updating a pull request, check the remote state first, and do not push or create it again until you know what is already there.',
      '- Nothing that was waiting for approval was approved. Ask again if you still need it.',
      'Then finish the original request and say what you checked.',
    ].join('\n'),
  ].join('\n\n');
}

async function originalRequest(db: Db, runId: string): Promise<string | null> {
  const { rows } = await db.query<{ content: string }>(
    `WITH RECURSIVE chain AS (
       SELECT id, continues_run_id, user_message_id, 0 AS depth FROM runs WHERE id = $1
       UNION ALL
       SELECT r.id, r.continues_run_id, r.user_message_id, chain.depth + 1
       FROM runs r JOIN chain ON r.id = chain.continues_run_id
       WHERE chain.depth < 100
     )
     SELECT m.content FROM chain JOIN messages m ON m.id = chain.user_message_id
     ORDER BY chain.depth DESC LIMIT 1`,
    [runId],
  );
  return rows[0]?.content ?? null;
}

async function lastStep(db: Db, runId: string): Promise<LastStep | null> {
  const { rows } = await db.query<{ type: string; name: string | null }>(
    `SELECT e.type, e.payload->>'stepName' AS name FROM run_events e
     JOIN runs r ON r.id = e.run_id
     WHERE (r.id = $1 OR r.parent_run_id = $1) AND e.type IN ('STEP_STARTED', 'STEP_FINISHED')
       AND ${STEP_NOT_INTERRUPTED}
     ORDER BY e.created_at DESC, e.seq DESC LIMIT 1`,
    [runId],
  );
  const step = rows[0];
  if (!step?.name) return null;
  return { name: step.name, finished: step.type === 'STEP_FINISHED' };
}

async function expiredApprovals(db: Db, runId: string): Promise<string[]> {
  const { rows } = await db.query<{ title: string }>(
    `SELECT a.title FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE (r.id = $1 OR r.parent_run_id = $1) AND a.status = 'expired'
       AND a.decided_by = 'recovery'
     ORDER BY a.created_at, a.id`,
    [runId],
  );
  return rows.map((row) => row.title);
}

async function stoppedAt(db: Db, runId: string): Promise<Date | null> {
  const { rows } = await db.query<{ finished_at: Date | null }>(
    'SELECT finished_at FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0]?.finished_at ?? null;
}

export async function withInterruptionNote(
  db: Db,
  input: RunInput,
  interruptedRunId: string,
): Promise<RunInput> {
  const request = (await originalRequest(db, interruptedRunId)) ?? input.userRequest;
  const changes = await runChanges(db, input.workspaceId, interruptedRunId, true).catch(() => null);
  const note = interruptionNote({
    request,
    stoppedAt: await stoppedAt(db, interruptedRunId),
    lastStep: await lastStep(db, interruptedRunId),
    files: changes?.files.map((file) => file.path) ?? [],
    waitingFor: await expiredApprovals(db, interruptedRunId),
  });
  return { ...input, prompt: note, userRequest: request };
}

export const CONTINUED_SESSION_METHOD = 'interruption/session';

export function auditContinuedSession(
  audit: Pick<ProtocolObserver, 'message'>,
  input: Pick<RunInput, 'continuesRunId'>,
  target: SessionTarget | undefined,
  output: Extract<ProviderOutput, { kind: 'session' }>,
): void {
  if (!input.continuesRunId || !target?.interrupted) return;
  audit.message('harness', {
    method: CONTINUED_SESSION_METHOD,
    params: {
      continues: input.continuesRunId,
      requestedBy: 'user',
      decision: output.continued ? 'reopened the interrupted session' : 'fresh session',
      reason: output.continued ? null : output.freshReason,
      sessionId: output.sessionId,
    },
  });
}

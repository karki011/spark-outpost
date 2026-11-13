import {
  workflowSchema,
  type Workflow,
  type WorkflowRun,
  type WorkflowRunKind,
  type WorkflowRunSource,
  type WorkflowRunStatus,
  type WorkflowRunStep,
  type WorkflowStepState,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';

export const STEP_OUTCOME_UNKNOWN = 'Outcome unknown: the worker stopped while this step ran.';

export interface NewWorkflowRun {
  id: string;
  workspaceId: string;
  workflow: Workflow;
  kind: WorkflowRunKind;
  source: WorkflowRunSource;
  conversationId: string;
  runId: string;
  message: string;
  continues: boolean;
  oneSpark?: boolean;
}

export async function insertWorkflowRun(db: Queryable, run: NewWorkflowRun): Promise<boolean> {
  const inserted = await db.query(
    `INSERT INTO workflow_runs (id, workspace_id, workflow_id, workflow_name, definition, kind,
       source, conversation_id, run_id, message, continues, one_spark)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (run_id) DO NOTHING`,
    [
      run.id,
      run.workspaceId,
      run.workflow.id,
      run.workflow.name,
      JSON.stringify(run.workflow),
      run.kind,
      run.source,
      run.conversationId,
      run.runId,
      run.message,
      run.continues,
      run.oneSpark === true,
    ],
  );
  if (inserted.rowCount !== 1) return false;
  await db.query(
    `INSERT INTO workflow_run_steps (workflow_run_id, step_id, position, spark_id)
     SELECT $1, step->>'id', position - 1, (step->>'sparkId')::uuid
     FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS listed (step, position)`,
    [run.id, JSON.stringify(run.workflow.steps)],
  );
  return true;
}

interface RunRow {
  id: string;
  workflow_id: string;
  workflow_name: string;
  definition: unknown;
  kind: WorkflowRunKind;
  source: WorkflowRunSource;
  status: WorkflowRunStatus;
  conversation_id: string | null;
  run_id: string | null;
  message: string;
  continues: boolean;
  stopped_by: string | null;
  started_at: Date;
  finished_at: Date | null;
}

interface StepRow {
  workflow_run_id: string;
  step_id: string;
  spark_id: string;
  state: WorkflowStepState;
  run_id: string | null;
  note: string | null;
  started_at: Date | null;
  finished_at: Date | null;
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

function toStep(row: StepRow): WorkflowRunStep {
  return {
    stepId: row.step_id,
    sparkId: row.spark_id,
    state: row.state,
    runId: row.run_id,
    note: row.note,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  };
}

function toRun(row: RunRow, steps: readonly StepRow[]): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    kind: row.kind,
    source: row.source,
    status: row.status,
    conversationId: row.conversation_id,
    runId: row.run_id,
    stoppedBy: row.stopped_by,
    steps: steps.filter((step) => step.workflow_run_id === row.id).map(toStep),
    startedAt: row.started_at.toISOString(),
    finishedAt: iso(row.finished_at),
  };
}

async function stepsOf(db: Queryable, ids: readonly string[]): Promise<StepRow[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<StepRow>(
    `SELECT * FROM workflow_run_steps WHERE workflow_run_id = ANY($1::uuid[])
     ORDER BY workflow_run_id, position`,
    [ids],
  );
  return rows;
}

async function assemble(db: Queryable, rows: readonly RunRow[]): Promise<WorkflowRun[]> {
  const steps = await stepsOf(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toRun(row, steps));
}

export async function getWorkflowRun(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<WorkflowRun | null> {
  const { rows } = await db.query<RunRow>(
    'SELECT * FROM workflow_runs WHERE id = $1 AND workspace_id = $2',
    [id, workspaceId],
  );
  return (await assemble(db, rows))[0] ?? null;
}

export const WORKFLOW_RUNS_PAGE = 100;

export async function listWorkflowRuns(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
): Promise<WorkflowRun[]> {
  const { rows } = await db.query<RunRow>(
    `SELECT * FROM workflow_runs WHERE workspace_id = $1 AND workflow_id = $2 AND kind = 'run'
     ORDER BY started_at DESC, id LIMIT $3`,
    [workspaceId, workflowId, WORKFLOW_RUNS_PAGE],
  );
  return assemble(db, rows);
}

export interface TurnWorkflowRun {
  run: WorkflowRun;
  workflow: Workflow;
  message: string;
  continues: boolean;
}

export async function workflowRunForTurn(
  db: Queryable,
  runId: string,
): Promise<TurnWorkflowRun | null> {
  const { rows } = await db.query<RunRow>('SELECT * FROM workflow_runs WHERE run_id = $1', [runId]);
  const row = rows[0];
  if (!row) return null;
  const [run] = await assemble(db, [row]);
  const workflow = workflowSchema.safeParse(row.definition);
  if (!run || !workflow.success) return null;
  return { run, workflow: workflow.data, message: row.message, continues: row.continues };
}

export async function startStep(
  db: Queryable,
  workflowRunId: string,
  stepId: string,
  runId: string,
): Promise<void> {
  await db.query(
    `UPDATE workflow_run_steps SET state = 'running', run_id = $3, started_at = now()
     WHERE workflow_run_id = $1 AND step_id = $2 AND state = 'waiting'`,
    [workflowRunId, stepId, runId],
  );
}

export async function settleStep(
  db: Queryable,
  workflowRunId: string,
  stepId: string,
  state: Exclude<WorkflowStepState, 'waiting' | 'running'>,
  note: string | null,
): Promise<void> {
  await db.query(
    `UPDATE workflow_run_steps SET state = $3, note = $4, finished_at = now()
     WHERE workflow_run_id = $1 AND step_id = $2 AND state IN ('waiting', 'running')`,
    [workflowRunId, stepId, state, note],
  );
}

export async function finishWorkflowRun(
  db: Queryable,
  id: string,
  status: Exclude<WorkflowRunStatus, 'running'>,
  stoppedBy: string | null,
): Promise<void> {
  await db.query(
    `UPDATE workflow_runs SET status = $2, stopped_by = $3, finished_at = now()
     WHERE id = $1 AND status = 'running'`,
    [id, status, stoppedBy],
  );
}

export async function settleStrandedRuns(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ id: string; status: string | null }>(
    `SELECT w.id, r.status FROM workflow_runs w LEFT JOIN runs r ON r.id = w.run_id
     WHERE w.status = 'running'
       AND (r.id IS NULL OR r.status IN ('succeeded', 'failed', 'cancelled', 'outcome_unknown'))`,
  );
  for (const { id, status } of rows) {
    await db.query(
      `UPDATE workflow_run_steps s
       SET state = CASE seen.status WHEN 'succeeded' THEN 'succeeded'
                     WHEN 'cancelled' THEN 'cancelled' ELSE 'failed' END,
           note = CASE WHEN seen.status IN ('succeeded', 'cancelled', 'failed')
                    THEN COALESCE(s.note, seen.error) ELSE $2 END,
           finished_at = now()
       FROM (
         SELECT own.step_id, child.status, child.error
         FROM workflow_run_steps own LEFT JOIN runs child ON child.id = own.run_id
         WHERE own.workflow_run_id = $1
       ) AS seen
       WHERE s.workflow_run_id = $1 AND s.step_id = seen.step_id AND s.state = 'running'`,
      [id, STEP_OUTCOME_UNKNOWN],
    );
    await db.query(
      `UPDATE workflow_run_steps SET state = 'skipped', finished_at = now()
       WHERE workflow_run_id = $1 AND state = 'waiting'`,
      [id],
    );
    const settled = status === 'failed' || status === 'cancelled' ? status : 'outcome_unknown';
    await finishWorkflowRun(db, id, settled, null);
  }
  return rows.length;
}

import { z } from 'zod';
import {
  workflowControlActionSchema,
  workflowScheduleSchema,
  workflowTriggersSchema,
  type WorkflowControlAction,
} from '@spark-outpost/contracts';
import { crewDecision } from '../../crew/crew-path.ts';
import { CREW_EDIT_REFUSALS, crewEditRefusal } from '../../crew/tool-offer.ts';
import { listWorkflowRuns } from '../../crew-flows/run-records.ts';
import { getSchedule } from '../../crew-flows/schedule-records.ts';
import { getTriggers } from '../../crew-flows/trigger-records.ts';
import { controlWorkflow } from '../../crew-flows/workflow-control.ts';
import { workflowStore } from '../../crew-flows/workflow-store.ts';
import type { Queryable } from '../../persistence/db.ts';
import { newId } from '../../persistence/ids.ts';
import { listTeammates } from '../../persistence/teammates.ts';
import { listProjects } from '../../projects/projects.ts';
import { actionRun, proposeAction } from '../actions/confirm.ts';
import type { Performed } from '../actions/performed.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';

export const WORKFLOW_TOOL = 'spark_workflow';

const NEEDS = {
  schedule: 'schedule needs schedule.',
  triggers: 'triggers needs triggers.',
};

const WORKFLOW_TURN =
  'A turn a workflow started does not run workflows. Ask in a chat the user is working in.';

async function workflowTurn(db: Queryable, runId: string): Promise<boolean> {
  const { rows } = await db.query<{ workflow: boolean }>(
    `SELECT (COALESCE(p.source, r.source) = 'workflow'
             OR COALESCE((r.route->'spark') ? 'step', false)) AS workflow
     FROM runs r LEFT JOIN runs p ON p.id = r.parent_run_id WHERE r.id = $1`,
    [runId],
  );
  return rows[0]?.workflow === true;
}

async function findWorkflow(context: SparkToolContext, reference: string) {
  const teammates = await listTeammates(context.deps.db, context.scope.workspaceId);
  const flows = await workflowStore().list(new Set(teammates.map((teammate) => teammate.id)));
  const wanted = reference.trim().toLowerCase();
  const found = flows.find((flow) => flow.id === wanted || flow.name.toLowerCase() === wanted);
  if (found) return found;
  const names = flows.map((flow) => `${flow.name} (${flow.id})`).join(', ') || 'none';
  throw new SparkToolError(`No workflow called ${reference}. Workflows: ${names}.`);
}

async function findProject(context: SparkToolContext, reference: string | undefined) {
  if (!reference) return null;
  const projects = await listProjects(context.deps.db, context.scope.workspaceId);
  const wanted = reference.toLowerCase();
  const found = projects.find((p) => p.id === wanted || p.name.toLowerCase() === wanted);
  if (!found) throw new SparkToolError(`No project called ${reference}.`);
  return { id: found.id, name: found.name };
}

function parsed<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new SparkToolError(`Check ${what}: ${issues.join('; ')}`);
}

interface WorkflowArgs {
  action: WorkflowControlAction['op'];
  workflow: string;
  message?: string | undefined;
  project?: string | undefined;
  run?: string | undefined;
  schedule?: Record<string, unknown> | undefined;
  triggers?: Record<string, unknown> | undefined;
}

function projectOf(project: { id: string } | null) {
  return project ? { projectId: project.id } : {};
}

async function runToStop(context: SparkToolContext, workflowId: string, reference?: string) {
  const runs = await listWorkflowRuns(context.deps.db, context.scope.workspaceId, workflowId);
  if (reference !== undefined && !z.uuid().safeParse(reference).success) {
    throw new SparkToolError('run must be a workflow run id from spark_crew.');
  }
  const found = reference
    ? runs.find((item) => item.id === reference)
    : runs.find((item) => item.status === 'running');
  if (!found) throw new SparkToolError('That workflow has no such run that is running.');
  if (found.status !== 'running') throw new SparkToolError('That run is not running.');
  return found.id;
}

async function buildAction(context: SparkToolContext, args: WorkflowArgs) {
  const { db } = context.deps;
  const { workspaceId } = context.scope;
  const flow = await findWorkflow(context, args.workflow);
  const project = await findProject(context, args.project);
  const base = {
    action: 'workflow_control' as const,
    op: args.action,
    workflowId: flow.id,
    name: flow.name,
    message: args.message?.trim() ?? '',
    project,
  };
  switch (args.action) {
    case 'run':
      return { ...base, messageId: newId() };
    case 'stop':
      return { ...base, workflowRunId: await runToStop(context, flow.id, args.run) };
    case 'schedule': {
      if (!args.schedule) throw new SparkToolError(NEEDS.schedule);
      const before = (await getSchedule(db, workspaceId, flow.id))?.schedule ?? null;
      const merged = { projectId: null, ...before, ...projectOf(project), ...args.schedule };
      const schedule = parsed(workflowScheduleSchema, merged, 'schedule');
      return { ...base, schedule, scheduleBefore: before };
    }
    case 'triggers': {
      if (!args.triggers) throw new SparkToolError(NEEDS.triggers);
      const before = (await getTriggers(db, workspaceId, flow.id))?.triggers ?? null;
      const merged = { ...before, ...projectOf(project), ...args.triggers };
      const triggers = parsed(workflowTriggersSchema, merged, 'triggers');
      return { ...base, triggers, triggersBefore: before };
    }
    case 'unschedule':
      return base;
  }
}

async function control(args: WorkflowArgs, context: SparkToolContext) {
  const run = actionRun(context.scope);
  const { db } = context.deps;
  const refused = await crewEditRefusal(db, context.scope);
  if (refused) throw new SparkToolError(CREW_EDIT_REFUSALS[refused]);
  if (args.action === 'run' && (await workflowTurn(db, run.runId))) {
    throw new SparkToolError(WORKFLOW_TURN);
  }
  const action = parsed(
    workflowControlActionSchema,
    await buildAction(context, args),
    'the request',
  );
  return proposeAction(context, action, {
    decide: () => crewDecision(db, run.runId, run.scope.observations, action.action),
  });
}

export async function performWorkflowControl(
  context: SparkToolContext,
  action: WorkflowControlAction,
): Promise<Performed> {
  const done = await controlWorkflow(
    {
      db: context.deps.db,
      workspaceId: context.scope.workspaceId,
      chatFolders: context.deps.chatFolders,
    },
    action,
  );
  return { message: done.message, url: null, output: done.output };
}

export const workflowTool = sparkTool({
  name: WORKFLOW_TOOL,
  needs: 'crew_flows',
  acts: true,
  title: 'Run, stop, schedule or trigger a workflow',
  description:
    'workflow: id or name. run (new chat; message, project), stop (run id or its running run), schedule (schedule: {enabled, every, unit, days, from, to, anchor, message, missed}), unschedule, triggers ({chatStarted, turnChanged, beforePublish, commit, pullRequest, …}); fields you pass change, see spark_crew. Follows your mode.',
  input: {
    action: z.enum(['run', 'stop', 'schedule', 'unschedule', 'triggers']),
    workflow: z.string().trim().min(1).max(100),
    message: z.string().max(4000).optional(),
    project: z.string().optional(),
    run: z.string().optional(),
    schedule: z.record(z.string(), z.unknown()).optional(),
    triggers: z.record(z.string(), z.unknown()).optional(),
  },
  run: (args, context) => control(args, context),
});

import { z } from 'zod';
import {
  CREW_EDIT_ALLOW_LABEL,
  CREW_EDIT_DENY_LABEL,
  CREW_SIMILAR_MAX,
  SPARK_ACTION_KIND,
  SPARK_ACTION_OPTION,
  SPARK_INSTRUCTIONS_FILE,
  type ApprovalOption,
  type CrewEditAction,
  type CrewSimilar,
  type Teammate,
} from '@spark-outpost/contracts';
import { workflowStore } from '../../crew-flows/workflow-store.ts';
import { planSparkEdit, type CrewFileInput, type CrewProblem } from '../../crew/crew-edit-plan.ts';
import { crewSparks, skillCandidates, sparkCandidates } from '../../crew/crew-view.ts';
import { crewSparksDir } from '../../crew/folders.ts';
import { similarTo } from '../../crew/similar.ts';
import { CREW_EDIT_REFUSALS, crewEditRefusal } from '../../crew/tool-offer.ts';
import {
  planWorkflowRemoval,
  planWorkflowSave,
  type WorkflowEditPlan,
} from '../../crew/workflow-edit-plan.ts';
import type { Queryable } from '../../persistence/db.ts';
import { listTeammates } from '../../persistence/teammates.ts';
import { actionRun, proposeAction, WAITING_MESSAGE } from '../actions/confirm.ts';
import { rulesSession, type RulesSession } from '../actions/rules-edit-session.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { matchTeammate } from './teammates-tool.ts';

export const CREW_EDIT_TOOL = 'spark_crew_edit';

export const CREW_EDIT_OPTIONS: readonly ApprovalOption[] = [
  { optionId: SPARK_ACTION_OPTION.confirm, name: CREW_EDIT_ALLOW_LABEL, kind: 'allow_once' },
  { optionId: SPARK_ACTION_OPTION.decline, name: CREW_EDIT_DENY_LABEL, kind: 'reject_once' },
];

export const CREW_EDIT_USAGE =
  'Pass spark with files, remove (a skill) or removeFolder, or workflow, or remove alone (a workflow id).';

const PROBLEMS_MESSAGE =
  'Nothing was shown to the user. Fix these and call again (formats: spark_docs page crew-files).';

function problemsResult(problems: readonly CrewProblem[]) {
  return { outcome: 'problems', problems, message: PROBLEMS_MESSAGE };
}

async function waitingCard(
  db: Queryable,
  conversationId: string,
  action: CrewEditAction,
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT a.id FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND a.kind = $2 AND a.status = 'pending'
       AND a.payload->'sparkAction'->>'action' = 'crew_edit'
       AND a.payload->'sparkAction'->>'target' = $3
       AND a.payload->'sparkAction'->>'id' = $4
       AND a.payload->'sparkAction'->'files' = $5::jsonb
     ORDER BY a.created_at DESC LIMIT 1`,
    [conversationId, SPARK_ACTION_KIND, action.target, action.id, JSON.stringify(action.files)],
  );
  return rows[0]?.id ?? null;
}

async function propose(context: SparkToolContext, action: CrewEditAction) {
  const waiting = await waitingCard(context.deps.db, context.scope.conversationId!, action);
  if (waiting) {
    return { outcome: 'waiting_for_user', approvalId: waiting, message: WAITING_MESSAGE };
  }
  return proposeAction(context, action, {
    path: 'confirm',
    options: CREW_EDIT_OPTIONS,
    audit: { floor: 'spark_crew' },
  });
}

interface SparkEditArgs {
  spark: string;
  files: CrewFileInput[];
  remove: string | null;
  removeFolder: string | null;
}

async function editSpark(
  context: SparkToolContext,
  args: SparkEditArgs,
  teammates: readonly Teammate[],
  session: RulesSession,
) {
  const teammate = matchTeammate(teammates, args.spark);
  const sparksDir = crewSparksDir();
  const plan = await planSparkEdit(
    sparksDir,
    teammate.id,
    args.files,
    args.remove,
    args.removeFolder,
  );
  if (plan.problems.length > 0) return problemsResult(plan.problems);
  if (plan.files.length === 0) {
    return { outcome: 'unchanged', message: `${teammate.name} already has exactly that.` };
  }
  const crew = await crewSparks(sparksDir, teammates);
  const similar: CrewSimilar[] = plan.newSkills.flatMap((skill) =>
    similarTo(skill, skillCandidates(crew)),
  );
  const firstInstructions = plan.files.some(
    (file) => file.path === SPARK_INSTRUCTIONS_FILE && file.change === 'new',
  );
  if (firstInstructions) {
    similar.push(
      ...similarTo(
        { name: teammate.name, description: teammate.role },
        sparkCandidates(crew, teammate.id),
      ),
    );
  }
  return propose(context, {
    action: 'crew_edit',
    target: 'spark',
    id: teammate.id,
    name: teammate.name,
    files: plan.files,
    similar: similar.slice(0, CREW_SIMILAR_MAX),
    agent: session.agent,
    modeName: session.modeName,
  });
}

async function editWorkflow(
  context: SparkToolContext,
  plan: WorkflowEditPlan,
  session: RulesSession,
) {
  if (plan.problems.length > 0) return problemsResult(plan.problems);
  if (!plan.file) return { outcome: 'unchanged', message: `${plan.name} already says that.` };
  return propose(context, {
    action: 'crew_edit',
    target: 'workflow',
    id: plan.id,
    name: plan.name,
    files: [plan.file],
    stages: plan.stages,
    similar: [],
    agent: session.agent,
    modeName: session.modeName,
  });
}

interface EditArgs {
  spark?: string | undefined;
  files?: CrewFileInput[] | undefined;
  remove?: string | undefined;
  removeFolder?: string | undefined;
  workflow?: Record<string, unknown> | undefined;
}

async function edit(args: EditArgs, context: SparkToolContext) {
  const run = actionRun(context.scope);
  const { db } = context.deps;
  const refused = await crewEditRefusal(db, context.scope);
  if (refused) throw new SparkToolError(CREW_EDIT_REFUSALS[refused]);
  const session = await rulesSession(db, run.runId);
  if (!session) throw new SparkToolError(CREW_EDIT_REFUSALS.no_chat);
  const teammates = await listTeammates(db, context.scope.workspaceId);
  const { spark, workflow } = args;
  const files = args.files ?? [];
  const remove = args.remove?.trim() || undefined;
  const removeFolder = args.removeFolder?.trim() || undefined;
  if (spark !== undefined) {
    if (workflow || (files.length === 0 && !remove && !removeFolder)) {
      throw new SparkToolError(CREW_EDIT_USAGE);
    }
    return editSpark(
      context,
      { spark, files, remove: remove ?? null, removeFolder: removeFolder ?? null },
      teammates,
      session,
    );
  }
  if (removeFolder || files.length > 0 || (workflow && remove) || (!workflow && !remove)) {
    throw new SparkToolError(CREW_EDIT_USAGE);
  }
  const store = workflowStore();
  const plan = workflow
    ? await planWorkflowSave(store, workflow, teammates)
    : await planWorkflowRemoval(store, remove!, teammates);
  return editWorkflow(context, plan, session);
}

export const crewEditTool = sparkTool({
  name: CREW_EDIT_TOOL,
  needs: 'crew_edit',
  acts: true,
  title: 'Change a Spark’s files or a workflow',
  description:
    'Propose changes to one Spark’s files (SPARK.md, skills/<name>/SKILL.md, scripts) or one workflow; formats: spark_docs crew-files. Always a card, answered on the Mac. remove: a skill (with spark) or a workflow id.',
  input: {
    spark: z.string().optional(),
    files: z
      .array(z.object({ path: z.string(), text: z.string().nullable() }))
      .optional()
      .describe('text: the whole file; null deletes it.'),
    remove: z.string().optional(),
    removeFolder: z.string().optional(),
    workflow: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('{id, name, steps: [{id, spark, prompt, dependsOn, join, onFailure}]}'),
  },
  run: (args, context) => edit(args, context),
});

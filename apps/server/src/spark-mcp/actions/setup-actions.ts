import { z } from 'zod';
import {
  SETUP_FIELD_MAX,
  setupTargetSchema,
  setupTargets,
  type SparkAction,
} from '@spark-outpost/contracts';
import { saveSetupDraft } from '../../persistence/setup-drafts.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { ACTION_NOTE } from './action-note.ts';
import { proposeAction } from './confirm.ts';
import type { Performed } from './performed.ts';
import { setupFieldProblem } from './setup-fields.ts';

type PrepareSetup = Extract<SparkAction, { action: 'prepare_setup' }>;

const FIELD_GUIDE = Object.entries(setupTargets)
  .filter(([, facts]) => facts.fields.length > 0)
  .map(([target, facts]) => `${target}: ${facts.fields.join(', ')}`)
  .join('; ');

async function prepare(
  context: SparkToolContext,
  args: { target: PrepareSetup['target']; fields?: Record<string, string> | undefined },
) {
  const fields = args.fields ?? {};
  const problem = setupFieldProblem(args.target, fields);
  if (problem) throw new SparkToolError(problem);
  const facts = setupTargets[args.target];
  return proposeAction(context, {
    action: 'prepare_setup',
    target: args.target,
    name: facts.name,
    fields,
    place: facts.place,
    finish: facts.finish,
  });
}

export async function performPrepareSetup(
  context: SparkToolContext,
  action: PrepareSetup,
): Promise<Performed> {
  const problem = setupFieldProblem(action.target, action.fields);
  if (problem) throw new Error(problem);
  await saveSetupDraft(context.deps.db, {
    workspaceId: context.scope.workspaceId,
    target: action.target,
    fields: action.fields,
    conversationId: context.scope.conversationId ?? null,
  });
  return {
    message: `Prepared ${action.name} in ${action.place}. Nothing is connected yet: ${action.finish}`,
    url: null,
    output: { target: action.target, prepared: Object.keys(action.fields), finish: action.finish },
  };
}

export const prepareSetupTool = sparkTool({
  name: 'spark_prepare_setup',
  title: 'Prepare an AI provider or connector',
  acts: true,
  description:
    `Prefill an AI provider or connector form with non-secret fields; the user types the key or signs in and connects it. Never pass a secret. Fields: ${FIELD_GUIDE}. ` +
    ACTION_NOTE,
  input: {
    target: setupTargetSchema,
    fields: z
      .record(z.string().max(40), z.string().trim().min(1).max(SETUP_FIELD_MAX))
      .optional()
      .describe('Non-secret values by field name.'),
  },
  run: (args, context) => prepare(context, args),
});

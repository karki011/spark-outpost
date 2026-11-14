import { z } from 'zod';
import {
  faceFromName,
  providerIdSchema,
  teammateFaceSchema,
  teammateInstructionsSchema,
  teammateLevelSchema,
  teammateNameSchema,
  teammateRoleSchema,
  type SparkAction,
  type Teammate,
  type UpdateTeammateRequest,
} from '@spark-outpost/contracts';
import { crewSparks, sparkCandidates } from '../../crew/crew-view.ts';
import { crewSparksDir } from '../../crew/folders.ts';
import { similarTo } from '../../crew/similar.ts';
import { activeConnection } from '../../persistence/setup.ts';
import { closeTeammateSessions } from '../../persistence/teammate-chats.ts';
import { createTeammate, listTeammates, updateTeammate } from '../../persistence/teammates.ts';
import { listProjects } from '../../projects/projects.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { matchTeammate } from '../tools/teammates-tool.ts';
import { proposeAction } from './confirm.ts';
import type { Performed } from './performed.ts';

const CARD_NOTE = 'Always a card, answered on the Mac; returns waiting_for_user, never retry.';

const fieldsInput = {
  role: teammateRoleSchema.optional(),
  face: teammateFaceSchema.nullable().optional().describe('null = drawn from the name.'),
  provider: providerIdSchema.nullable().optional().describe('null = default.'),
  model: z.string().trim().min(1).nullable().optional(),
  agentMode: z.string().trim().min(1).nullable().optional(),
  autonomy: teammateLevelSchema.nullable().optional().describe('Automatic or Full auto → PR.'),
  instructions: teammateInstructionsSchema.optional().describe('The whole SPARK.md.'),
  projects: z.array(z.string().trim().min(1)).max(8).optional().describe('Names or ids.'),
};

type Fields = z.output<z.ZodObject<typeof fieldsInput>>;
type ProjectRef = { id: string; name: string };

async function resolveProjects(context: SparkToolContext, references: readonly string[]) {
  const projects = await listProjects(context.deps.db, context.scope.workspaceId);
  return references.map((reference): ProjectRef => {
    const wanted = reference.toLowerCase();
    const found = projects.find(
      (project) => project.id === wanted || project.name.toLowerCase() === wanted,
    );
    if (!found) throw new SparkToolError(`No project called ${reference}.`);
    return { id: found.id, name: found.name };
  });
}

async function assertConnected(context: SparkToolContext, provider: string | null) {
  const parsed = providerIdSchema.safeParse(provider);
  if (!parsed.success) return;
  if (await activeConnection(context.deps.db, context.scope.workspaceId, parsed.data)) return;
  throw new SparkToolError(`Connect ${parsed.data} before giving it to a Spark.`);
}

async function create(context: SparkToolContext, args: Fields & { name: string }) {
  await assertConnected(context, args.provider ?? null);
  const existing = await listTeammates(context.deps.db, context.scope.workspaceId);
  if (existing.some((teammate) => teammate.name.toLowerCase() === args.name.toLowerCase())) {
    throw new SparkToolError(`There is already a Spark named ${args.name}.`);
  }
  const action: SparkAction = {
    action: 'create_teammate',
    name: args.name,
    role: args.role ?? '',
    face: args.face ?? faceFromName(args.name),
    faceAuto: !args.face,
    provider: args.provider ?? null,
    model: args.model ?? null,
    agentMode: args.agentMode ?? null,
    level: args.autonomy ?? null,
    instructions: args.instructions ?? '',
    projects: await resolveProjects(context, args.projects ?? []),
    similar: similarTo(
      { name: args.name, description: args.role ?? '' },
      sparkCandidates(await crewSparks(crewSparksDir(), existing), null),
    ),
  };
  return proposeAction(context, action, { alwaysAsk: true });
}

type ActionOf<Name extends SparkAction['action']> = Extract<SparkAction, { action: Name }>;

export async function performCreateTeammate(
  context: SparkToolContext,
  action: ActionOf<'create_teammate'>,
): Promise<Performed> {
  const created = await createTeammate(context.deps.db, context.scope.workspaceId, {
    name: action.name,
    role: action.role,
    face: action.faceAuto ? null : action.face,
    provider: action.provider,
    model: action.model,
    effort: null,
    agentMode: action.agentMode,
    level: action.level,
    instructions: action.instructions,
    projectIds: action.projects.map((project) => project.id),
  });
  return { message: `Added ${created.name} to Sparks.`, url: null, output: { id: created.id } };
}

function changesOf(current: Teammate, args: Fields & { name?: string | undefined }) {
  const update: UpdateTeammateRequest = {};
  if (args.name !== undefined && args.name !== current.name) update.name = args.name;
  if (args.role !== undefined && args.role !== current.role) update.role = args.role;
  const picked = current.faceAuto ? null : current.face;
  if (args.face !== undefined && JSON.stringify(args.face) !== JSON.stringify(picked)) {
    update.face = args.face;
  }
  if (args.provider !== undefined && args.provider !== current.provider) {
    update.provider = args.provider;
  }
  if (args.model !== undefined && args.model !== current.model) update.model = args.model;
  if (args.agentMode !== undefined && args.agentMode !== current.agentMode) {
    update.agentMode = args.agentMode;
  }
  if (args.autonomy !== undefined && args.autonomy !== current.level) update.level = args.autonomy;
  if (args.instructions !== undefined && args.instructions !== current.instructions) {
    update.instructions = args.instructions;
  }
  return update;
}

function faceAfter(current: Teammate, changes: UpdateTeammateRequest) {
  const faceAuto = changes.face === undefined ? current.faceAuto : changes.face === null;
  const picked = changes.face ?? current.face;
  return { faceAuto, face: faceAuto ? faceFromName(changes.name ?? current.name) : picked };
}

async function update(
  context: SparkToolContext,
  args: Fields & { spark: string; name?: string | undefined },
) {
  const { db } = context.deps;
  const { workspaceId } = context.scope;
  const current = matchTeammate(await listTeammates(db, workspaceId), args.spark);
  const changes = changesOf(current, args);
  const projects = args.projects ? await resolveProjects(context, args.projects) : null;
  const projectIds = projects?.map((project) => project.id);
  if (projectIds && projectIds.join() !== current.projectIds.join()) {
    changes.projectIds = projectIds;
  }
  if (Object.keys(changes).length === 0) throw new SparkToolError('Nothing would change.');
  await assertConnected(context, changes.provider ?? null);
  const names = new Map((await listProjects(db, workspaceId)).map((p) => [p.id, p.name]));
  const action: SparkAction = {
    action: 'update_teammate',
    teammateId: current.id,
    name: changes.name ?? current.name,
    role: changes.role ?? current.role,
    ...faceAfter(current, changes),
    provider: changes.provider === undefined ? current.provider : changes.provider,
    model: changes.model === undefined ? current.model : changes.model,
    agentMode: changes.agentMode === undefined ? current.agentMode : changes.agentMode,
    level: changes.level === undefined ? current.level : changes.level,
    instructions: changes.instructions ?? current.instructions,
    projects:
      projects ?? current.projectIds.map((id) => ({ id, name: names.get(id) ?? 'Project' })),
    changed: Object.keys(changes),
    ...(changes.instructions === undefined ? {} : { instructionsBefore: current.instructions }),
  };
  return proposeAction(context, action, { alwaysAsk: true });
}

const CHANGEABLE = [
  'name',
  'role',
  'face',
  'provider',
  'model',
  'agentMode',
  'level',
  'instructions',
] as const;

function changesFrom(action: ActionOf<'update_teammate'>): UpdateTeammateRequest {
  const changed = new Set(action.changed);
  const update: Record<string, unknown> = {};
  for (const field of CHANGEABLE) if (changed.has(field)) update[field] = action[field];
  if (changed.has('face') && action.faceAuto) update.face = null;
  if (changed.has('projectIds')) update.projectIds = action.projects.map((project) => project.id);
  return update as UpdateTeammateRequest;
}

export async function performUpdateTeammate(
  context: SparkToolContext,
  action: ActionOf<'update_teammate'>,
): Promise<Performed> {
  const { db } = context.deps;
  const { workspaceId } = context.scope;
  const changes = changesFrom(action);
  const saved = await updateTeammate(db, workspaceId, action.teammateId, changes);
  if (changes.name !== undefined || changes.role !== undefined || changes.instructions) {
    await closeTeammateSessions(db, workspaceId, action.teammateId);
  }
  return {
    message: `Saved ${saved.name}.`,
    url: null,
    output: { id: saved.id, changed: Object.keys(changes) },
  };
}

export const createTeammateTool = sparkTool({
  name: 'spark_create_spark',
  title: 'Add a Spark (named teammate)',
  acts: true,
  description: 'Propose a new Spark (named teammate). ' + CARD_NOTE,
  input: { name: teammateNameSchema, ...fieldsInput },
  run: (args, context) => create(context, args),
});

export const updateTeammateTool = sparkTool({
  name: 'spark_update_spark',
  title: 'Change a Spark',
  acts: true,
  description: 'Propose changes to a Spark; only the fields you pass change. ' + CARD_NOTE,
  input: {
    spark: z.string().trim().min(1).max(100),
    name: teammateNameSchema.optional(),
    ...fieldsInput,
  },
  run: (args, context) => update(context, args),
});

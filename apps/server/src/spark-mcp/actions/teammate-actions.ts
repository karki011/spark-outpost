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
import { activeConnection } from '../../persistence/setup.ts';
import { closeTeammateSessions } from '../../persistence/teammate-chats.ts';
import { createTeammate, listTeammates, updateTeammate } from '../../persistence/teammates.ts';
import { listProjects } from '../../projects/projects.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { matchTeammate } from '../tools/teammates-tool.ts';
import { confirmThen } from './confirm.ts';

const fieldsInput = {
  role: teammateRoleSchema.optional().describe('Role or title, such as "Release manager".'),
  face: teammateFaceSchema
    .optional()
    .describe('Blob face: shape and colour. Defaults to one picked from the name.'),
  provider: providerIdSchema
    .nullable()
    .optional()
    .describe('claude, codex or zai; null = default.'),
  model: z.string().trim().min(1).max(200).nullable().optional(),
  agentMode: z.string().trim().min(1).max(200).nullable().optional(),
  autonomy: teammateLevelSchema
    .nullable()
    .optional()
    .describe('balanced (Review each step), hands-off (Automatic) or full-auto (Full auto → PR).'),
  instructions: teammateInstructionsSchema
    .optional()
    .describe('Standing instructions added to every chat with this Spark.'),
  projects: z
    .array(z.string().trim().min(1).max(200))
    .max(8)
    .optional()
    .describe('Default project names or ids.'),
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
    provider: args.provider ?? null,
    model: args.model ?? null,
    agentMode: args.agentMode ?? null,
    level: args.autonomy ?? null,
    instructions: args.instructions ?? '',
    projects: await resolveProjects(context, args.projects ?? []),
  };
  return confirmThen(context, action, async (confirmed) => {
    if (confirmed.action !== 'create_teammate') throw new Error('Unexpected action.');
    const created = await createTeammate(context.deps.db, context.scope.workspaceId, {
      name: confirmed.name,
      role: confirmed.role,
      face: confirmed.face,
      provider: confirmed.provider,
      model: confirmed.model,
      agentMode: confirmed.agentMode,
      level: confirmed.level,
      instructions: confirmed.instructions,
      projectIds: confirmed.projects.map((project) => project.id),
    });
    return { id: created.id, name: created.name, message: `Added ${created.name} to Sparks.` };
  });
}

function changesOf(current: Teammate, args: Fields & { name?: string | undefined }) {
  const update: UpdateTeammateRequest = {};
  if (args.name !== undefined && args.name !== current.name) update.name = args.name;
  if (args.role !== undefined && args.role !== current.role) update.role = args.role;
  if (args.face && JSON.stringify(args.face) !== JSON.stringify(current.face)) {
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
    face: changes.face ?? current.face,
    provider: changes.provider === undefined ? current.provider : changes.provider,
    model: changes.model === undefined ? current.model : changes.model,
    agentMode: changes.agentMode === undefined ? current.agentMode : changes.agentMode,
    level: changes.level === undefined ? current.level : changes.level,
    instructions: changes.instructions ?? current.instructions,
    projects:
      projects ?? current.projectIds.map((id) => ({ id, name: names.get(id) ?? 'Project' })),
    changed: Object.keys(changes),
  };
  return confirmThen(context, action, async () => {
    const saved = await updateTeammate(db, workspaceId, current.id, changes);
    if (changes.name !== undefined || changes.role !== undefined || changes.instructions) {
      await closeTeammateSessions(db, workspaceId, current.id);
    }
    return { id: saved.id, changed: Object.keys(changes), message: `Saved ${saved.name}.` };
  });
}

export const createTeammateTool = sparkTool({
  name: 'spark_create_spark',
  title: 'Add a Spark (named teammate)',
  acts: true,
  description:
    'Propose a new Spark: a named teammate with a role, blob face, default provider, model, mode, autonomy and projects, and standing instructions added to every chat with it. Shows the user a confirm card; nothing is created until they confirm.',
  input: { name: teammateNameSchema, ...fieldsInput },
  run: (args, context) => create(context, args),
});

export const updateTeammateTool = sparkTool({
  name: 'spark_update_spark',
  title: 'Change a Spark',
  acts: true,
  description:
    'Propose changes to an existing Spark (pass spark: its name or id): rename it, change its role, face, defaults, projects or standing instructions. Only the fields you pass change. Shows a confirm card with the changes; nothing is saved until the user confirms. Chats already started keep their own settings.',
  input: {
    spark: z.string().trim().min(1).max(100).describe('The Spark to change: name or id.'),
    name: teammateNameSchema.optional().describe('A new name.'),
    ...fieldsInput,
  },
  run: (args, context) => update(context, args),
});

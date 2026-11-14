import { z } from 'zod';
import { CREW_FILE_MAX_BYTES, type SkillSummary } from './crew-files.ts';
import { INVOLVEMENT_LEVEL_IDS } from './involvement-levels.ts';
import { CONVERSATION_PROJECTS_MAX } from './projects.ts';
import { providerIdSchema } from './provider-ids.ts';
import type { RunStatus } from './runs.ts';

export const teammateLevelSchema = z.enum(INVOLVEMENT_LEVEL_IDS);

export const TEAMMATE_NAME_MAX = 40;
export const TEAMMATE_ROLE_MAX = 60;
export const TEAMMATE_INSTRUCTIONS_MAX = 2000;
export const TEAMMATES_MAX = 50;
export const INSTRUCTIONS_PATH_MAX = 1024;
export const INSTRUCTIONS_FILE_MAX_BYTES = 256 * 1024;
export const INSTRUCTIONS_FILE_EXTENSIONS = ['.md', '.markdown', '.mdc', '.txt'] as const;

export function isInstructionsFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return INSTRUCTIONS_FILE_EXTENSIONS.some(
    (extension) => lower.endsWith(extension) && lower.length > extension.length,
  );
}

export const TEAMMATE_SHAPES = [
  'round',
  'organic',
  'boxy',
  'capsule',
  'nub',
  'cloud',
  'droplet',
  'hexagon',
  'sun',
  'triangle',
] as const;
export type TeammateShape = (typeof TEAMMATE_SHAPES)[number];

export const TEAMMATE_COLORS = [
  'ember',
  'gold',
  'moss',
  'teal',
  'sky',
  'violet',
  'plum',
  'rose',
] as const;
export type TeammateColor = (typeof TEAMMATE_COLORS)[number];

export const teammateFaceSchema = z.object({
  shape: z.enum(TEAMMATE_SHAPES),
  color: z.enum(TEAMMATE_COLORS),
});
export type TeammateFace = z.infer<typeof teammateFaceSchema>;

export function nameHash(name: string): number {
  let hash = 0x811c9dc5;
  for (const char of name.trim().toLowerCase()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function faceFromName(name: string): TeammateFace {
  const hash = nameHash(name);
  return {
    shape: TEAMMATE_SHAPES[hash % TEAMMATE_SHAPES.length]!,
    color: TEAMMATE_COLORS[(hash >>> 8) % TEAMMATE_COLORS.length]!,
  };
}

export const teammateNameSchema = z
  .string()
  .trim()
  .min(1, 'Give your Spark a name.')
  .max(TEAMMATE_NAME_MAX, `Keep the name to ${TEAMMATE_NAME_MAX} characters.`)
  .regex(/^[^\n\r<>`]+$/, 'Use letters, numbers and simple punctuation in the name.');

export const teammateRoleSchema = z
  .string()
  .trim()
  .max(TEAMMATE_ROLE_MAX, `Keep the role to ${TEAMMATE_ROLE_MAX} characters.`)
  .regex(/^[^\n\r<>`]*$/, 'Keep the role on one line.');

export const teammateInstructionsSchema = z
  .string()
  .trim()
  .max(
    CREW_FILE_MAX_BYTES,
    `Keep standing instructions under ${Math.round(CREW_FILE_MAX_BYTES / 1024)} KB.`,
  );

export const instructionsPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(INSTRUCTIONS_PATH_MAX, 'That file path is too long.')
  .refine((value) => value.startsWith('/'), 'Choose a file by its full path.');

export const instructionsFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  text: z.string(),
  truncated: z.boolean(),
  problem: z.string().nullable(),
});
export type InstructionsFile = z.infer<typeof instructionsFileSchema>;

const projectIdsSchema = z
  .array(z.uuid())
  .max(CONVERSATION_PROJECTS_MAX)
  .refine((ids) => new Set(ids).size === ids.length, 'List each project once.');

export const teammateStateSchema = z.enum(['idle', 'working', 'needs_you', 'done', 'failed']);
export type TeammateState = z.infer<typeof teammateStateSchema>;

export const teammateTagSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: z.string(),
  face: teammateFaceSchema,
});
export type TeammateTag = z.infer<typeof teammateTagSchema>;

export const teammateSchema = teammateTagSchema.extend({
  faceAuto: z.boolean(),
  provider: providerIdSchema.nullable(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  agentMode: z.string().nullable(),
  level: teammateLevelSchema.nullable(),
  instructions: z.string(),
  instructionsPath: z.string().nullable(),
  projectIds: z.array(z.uuid()),
  homeConversationId: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Teammate = z.infer<typeof teammateSchema>;

export const teammateActivitySchema = z.object({
  conversationId: z.uuid(),
  title: z.string(),
  at: z.string(),
});
export type TeammateActivity = z.infer<typeof teammateActivitySchema>;

export const teammateViewSchema = teammateSchema.extend({
  state: teammateStateSchema,
  chatCount: z.number().int().nonnegative(),
  lastActivity: teammateActivitySchema.nullable(),
});
export type TeammateView = z.infer<typeof teammateViewSchema>;

export const TEAMMATE_STARTER_IDS = ['pip', 'wren', 'bolt'] as const;
export const teammateStarterIdSchema = z.enum(TEAMMATE_STARTER_IDS);
export type TeammateStarterId = z.infer<typeof teammateStarterIdSchema>;

export const teammateListSchema = z.object({
  teammates: z.array(teammateViewSchema),
  starters: z.array(teammateStarterIdSchema),
});
export type TeammateList = z.infer<typeof teammateListSchema>;

const teammateDefaultsShape = {
  provider: providerIdSchema.nullable(),
  model: z.string().trim().min(1).max(200).nullable(),
  effort: z.string().trim().min(1).max(40).nullable(),
  agentMode: z.string().trim().min(1).max(200).nullable(),
  level: teammateLevelSchema.nullable(),
};

export const createTeammateRequestSchema = z.object({
  name: teammateNameSchema,
  role: teammateRoleSchema.default(''),
  face: teammateFaceSchema.nullable().optional(),
  provider: teammateDefaultsShape.provider.default(null),
  model: teammateDefaultsShape.model.default(null),
  effort: teammateDefaultsShape.effort.default(null),
  agentMode: teammateDefaultsShape.agentMode.default(null),
  level: teammateDefaultsShape.level.default(null),
  instructions: teammateInstructionsSchema.default(''),
  instructionsPath: instructionsPathSchema.nullable().optional(),
  projectIds: projectIdsSchema.default([]),
});
export type CreateTeammateRequest = z.input<typeof createTeammateRequestSchema>;
export type NewTeammate = z.output<typeof createTeammateRequestSchema>;

export const updateTeammateRequestSchema = z
  .object({
    name: teammateNameSchema,
    role: teammateRoleSchema,
    face: teammateFaceSchema.nullable(),
    ...teammateDefaultsShape,
    instructions: teammateInstructionsSchema,
    instructionsPath: instructionsPathSchema.nullable(),
    projectIds: projectIdsSchema,
  })
  .partial()
  .refine((update) => Object.values(update).some((value) => value !== undefined), {
    message: 'Change at least one thing about this Spark.',
  });
export type UpdateTeammateRequest = z.infer<typeof updateTeammateRequestSchema>;

export interface TeammateBriefSkill extends SkillSummary {
  folder: string;
}

export type TeammateBrief = Pick<Teammate, 'name' | 'role' | 'instructions'> & {
  folder?: string | null;
  skills?: readonly TeammateBriefSkill[];
};

export const linkTeammateRequestSchema = z.object({ teammateId: z.uuid().nullable() });
export type LinkTeammateRequest = z.infer<typeof linkTeammateRequestSchema>;

export const teammateChatSchema = z.object({
  conversationId: z.uuid(),
  teammate: teammateTagSchema.nullable(),
});
export type TeammateChat = z.infer<typeof teammateChatSchema>;

export interface TeammateStarter {
  id: TeammateStarterId;
  name: string;
  role: string;
  face: TeammateFace;
  instructions: string;
}

export const TEAMMATE_STARTERS: readonly TeammateStarter[] = [
  {
    id: 'pip',
    name: 'Pip',
    role: 'Code reviewer',
    face: { shape: 'round', color: 'sky' },
    instructions:
      'Review changes for bugs, risky edits and missing tests. Point to the file and line, explain the risk in one sentence, and suggest the smallest fix. Ask before editing anything.',
  },
  {
    id: 'wren',
    name: 'Wren',
    role: 'Docs writer',
    face: { shape: 'cloud', color: 'moss' },
    instructions:
      "Write and update docs in short, plain sentences. Match the project's existing style, lead with the task, and list the files you changed at the end.",
  },
  {
    id: 'bolt',
    name: 'Bolt',
    role: 'Bug fixer',
    face: { shape: 'boxy', color: 'ember' },
    instructions:
      'Reproduce the bug before changing code. Make the smallest fix, add a test that fails without it, and say what caused the bug in one or two sentences.',
  },
];

export function starterRequest(starter: TeammateStarter): CreateTeammateRequest {
  return {
    name: starter.name,
    role: starter.role,
    face: starter.face,
    instructions: starter.instructions,
  };
}

export const TEAMMATE_DONE_FRESH_MS = 60 * 60_000;
export const TEAMMATE_FAILED_FRESH_MS = 24 * 60 * 60_000;

export interface TeammateChatSignal {
  status: RunStatus | null;
  needsInput: boolean;
  finishedAt: string | null;
}

const WORKING: readonly RunStatus[] = ['queued', 'running'];
const FAILED: readonly RunStatus[] = ['failed', 'outcome_unknown'];

function latestFinished(chats: readonly TeammateChatSignal[]): TeammateChatSignal | null {
  let latest: TeammateChatSignal | null = null;
  for (const chat of chats) {
    if (!chat.finishedAt) continue;
    if (!latest || Date.parse(chat.finishedAt) > Date.parse(latest.finishedAt!)) latest = chat;
  }
  return latest;
}

export function teammateState(chats: readonly TeammateChatSignal[], now: Date): TeammateState {
  if (chats.some((chat) => chat.needsInput || chat.status === 'awaiting_approval')) {
    return 'needs_you';
  }
  if (chats.some((chat) => chat.status !== null && WORKING.includes(chat.status))) {
    return 'working';
  }
  const latest = latestFinished(chats);
  if (!latest?.status) return 'idle';
  const age = now.getTime() - Date.parse(latest.finishedAt!);
  if (FAILED.includes(latest.status)) return age <= TEAMMATE_FAILED_FRESH_MS ? 'failed' : 'idle';
  if (latest.status === 'succeeded') return age <= TEAMMATE_DONE_FRESH_MS ? 'done' : 'idle';
  return 'idle';
}

export const TEAMMATE_STATE_LABELS: Record<TeammateState, string> = {
  idle: 'Idle',
  working: 'Working',
  needs_you: 'Needs you',
  done: 'Done',
  failed: 'Failed',
};

export function teammateFilterKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

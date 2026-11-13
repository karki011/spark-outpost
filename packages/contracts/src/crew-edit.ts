import { z } from 'zod';
import { CREW_FILE_MAX_BYTES, crewPathSchema } from './crew-files.ts';
import { utf8Length } from './projects.ts';

export const CREW_EDIT_FILES_MAX = 20;
export const CREW_EDIT_TEXT_MAX_BYTES = 2 * CREW_FILE_MAX_BYTES;
export const CREW_SIMILAR_MAX = 8;

export const crewFileChangeKindSchema = z.enum(['new', 'changed', 'deleted']);
export type CrewFileChangeKind = z.infer<typeof crewFileChangeKindSchema>;

export const CREW_CHANGE_LABELS: Record<CrewFileChangeKind, string> = {
  new: 'New',
  changed: 'Changed',
  deleted: 'Deleted',
};

export const crewFileChangeSchema = z.object({
  path: crewPathSchema,
  change: crewFileChangeKindSchema,
  before: z.string().nullable(),
  after: z.string().nullable(),
  baseHash: z.string().max(100).nullable(),
});
export type CrewFileChange = z.infer<typeof crewFileChangeSchema>;

export const crewSimilarReasonSchema = z.enum(['same_name', 'similar_name', 'similar_description']);
export type CrewSimilarReason = z.infer<typeof crewSimilarReasonSchema>;

export const crewSimilarSchema = z.object({
  kind: z.enum(['spark', 'skill']),
  name: z.string().max(100),
  spark: z.string().max(100).nullable(),
  reason: crewSimilarReasonSchema,
});
export type CrewSimilar = z.infer<typeof crewSimilarSchema>;

const SIMILAR_REASONS: Record<CrewSimilarReason, string> = {
  same_name: 'same name',
  similar_name: 'similar name',
  similar_description: 'similar description',
};

export function crewSimilarText(similar: CrewSimilar): string {
  const what =
    similar.kind === 'spark'
      ? `the ${similar.name} Spark`
      : `the ${similar.name} skill${similar.spark ? ` of ${similar.spark}` : ''}`;
  return `${what} (${SIMILAR_REASONS[similar.reason]})`;
}

export const crewEditTargetSchema = z.enum(['spark', 'workflow']);
export type CrewEditTarget = z.infer<typeof crewEditTargetSchema>;

export const crewEditActionSchema = z.object({
  action: z.literal('crew_edit'),
  target: crewEditTargetSchema,
  id: z.string().max(40),
  name: z.string().max(100),
  files: z.array(crewFileChangeSchema).min(1).max(CREW_EDIT_FILES_MAX),
  stages: z
    .array(z.array(z.string().max(100)).max(100))
    .max(100)
    .optional(),
  similar: z.array(crewSimilarSchema).max(CREW_SIMILAR_MAX),
  agent: z.string().max(100),
  modeName: z.string().max(100),
});
export type CrewEditAction = z.infer<typeof crewEditActionSchema>;

export const CREW_EDIT_ALLOW_LABEL = 'Allow';
export const CREW_EDIT_DENY_LABEL = 'Deny';

export const crewEditLabels = {
  crew_edit: {
    question: 'Change this Spark?',
    confirm: CREW_EDIT_ALLOW_LABEL,
    doing: 'Changing the crew…',
  },
};

export function crewEditQuestion(action: CrewEditAction): string {
  return `Change the ${action.name} ${action.target === 'spark' ? 'Spark' : 'workflow'}?`;
}

export function crewEditByline(action: CrewEditAction): string {
  const count = action.files.length;
  const what =
    action.target === 'workflow' ? 'the workflow file' : count === 1 ? '1 file' : `${count} files`;
  return `${action.agent} · ${action.modeName} wants to change ${what}`;
}

export const CREW_EDIT_NOTE =
  'Only you can answer this, on your Mac. What a Spark’s files say reaches its agents as your own standing instructions, so read the new text before you allow it.';

export const CREW_ON_THE_MAC = 'Waiting for you on your Mac. Answered on the Mac only.';

export const CREW_EDIT_CONFLICT = 'Changed since the card was shown';

function bytesOf(text: string | null): number | null {
  return text === null ? null : utf8Length(text);
}

export function crewEditAuditFacts(action: CrewEditAction): Record<string, unknown> {
  return {
    action: action.action,
    target: action.target,
    id: action.id,
    files: action.files.map((file) => ({
      path: file.path,
      change: file.change,
      beforeBytes: bytesOf(file.before),
      afterBytes: bytesOf(file.after),
    })),
    similar: action.similar.length,
    agent: action.agent,
    modeName: action.modeName,
  };
}

export function crewEditConflicted(message: string | null | undefined): boolean {
  return message?.startsWith(CREW_EDIT_CONFLICT) === true;
}

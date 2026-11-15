import { z } from 'zod';
import { crewSlugSchema } from './crew-files.ts';

export const TRIGGER_DEBOUNCE_MAX = 1440;
export const BRANCH_GLOB_MAX = 200;
export const TRIGGER_EVENTS_PAGE = 50;

export const workflowTriggerKindSchema = z.enum([
  'turn_changed',
  'before_publish',
  'commit',
  'pull_request',
]);
export type WorkflowTriggerKind = z.infer<typeof workflowTriggerKindSchema>;

export const workflowTriggersSchema = z.object({
  turnChanged: z.boolean().default(false),
  beforePublish: z.boolean().default(false),
  holdOnFindings: z.boolean().default(false),
  commit: z.boolean().default(false),
  branchGlob: z.string().trim().max(BRANCH_GLOB_MAX).default(''),
  pullRequest: z.boolean().default(false),
  projectId: z.uuid().nullable().default(null),
  debounceMinutes: z.number().int().min(0).max(TRIGGER_DEBOUNCE_MAX).default(0),
  edits: z.boolean().default(false),
});
export type WorkflowTriggers = z.infer<typeof workflowTriggersSchema>;

export const triggerEventStateSchema = z.enum([
  'pending',
  'claimed',
  'started',
  'skipped',
  'not_started',
]);
export type TriggerEventState = z.infer<typeof triggerEventStateSchema>;

export const triggerEventReasonSchema = z.enum(['unchanged', 'problem', 'chat_gone', 'error']);
export type TriggerEventReason = z.infer<typeof triggerEventReasonSchema>;

export const queuedTriggerKindSchema = workflowTriggerKindSchema.exclude(['before_publish']);
export type QueuedTriggerKind = z.infer<typeof queuedTriggerKindSchema>;

export const triggerEventSchema = z.object({
  id: z.uuid(),
  kind: queuedTriggerKindSchema,
  conversationId: z.uuid(),
  chatTitle: z.string(),
  state: triggerEventStateSchema,
  reason: triggerEventReasonSchema.nullable(),
  detail: z.string().nullable(),
  dueAt: z.string(),
  workflowRunId: z.uuid().nullable(),
  updatedAt: z.string(),
});
export type TriggerEvent = z.infer<typeof triggerEventSchema>;

export const publishHoldStateSchema = z.enum(['open', 'released', 'cleared']);
export type PublishHoldState = z.infer<typeof publishHoldStateSchema>;

export const publishHoldSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  chatTitle: z.string(),
  workflowId: crewSlugSchema,
  findings: z.number().int().nonnegative(),
  finished: z.boolean(),
  state: publishHoldStateSchema,
  createdAt: z.string(),
});
export type PublishHold = z.infer<typeof publishHoldSchema>;

export const workflowTriggersViewSchema = z.object({
  triggers: workflowTriggersSchema.nullable(),
  events: z.array(triggerEventSchema),
  holds: z.array(publishHoldSchema),
});
export type WorkflowTriggersView = z.infer<typeof workflowTriggersViewSchema>;

export function anyTriggerOn(triggers: WorkflowTriggers): boolean {
  return triggers.turnChanged || triggers.beforePublish || triggers.commit || triggers.pullRequest;
}

function escapeRegex(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function globPattern(glob: string): RegExp {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (char === '*' && glob[index + 1] === '*') {
      pattern += '.*';
      index += 1;
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += escapeRegex(char);
  }
  return new RegExp(`^${pattern}$`);
}

export function branchGlobs(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function branchMatches(text: string, branch: string | null): boolean {
  const globs = branchGlobs(text);
  if (globs.length === 0) return true;
  if (!branch) return false;
  return globs.some((glob) => globPattern(glob).test(branch));
}

const BLOCKING_LINE =
  /^\s*(?:[-*+]|\d+[.)])?\s*(?:\*\*|__)?(?:\[\s*(?:critical|high)\s*\]|(?:critical|high)\s*(?:\*\*|__)?\s*:)/i;

export function blockingFindings(text: string | null): number {
  if (!text) return 0;
  return text.split('\n').filter((line) => BLOCKING_LINE.test(line)).length;
}

export const FINDINGS_FORMAT =
  'Start each finding on its own line with its severity in brackets: [Critical], [High], [Medium] or [Low]. Write "No findings." when there are none.';

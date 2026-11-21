import { z } from 'zod';
import { runStatusSchema, type RunStatus } from './runs.ts';

export const subChatStatusSchema = z.enum([
  'needs_you',
  'working',
  'held',
  'ready_for_review',
  'done',
]);
export type SubChatStatus = z.infer<typeof subChatStatusSchema>;

export const subChatPullStateSchema = z.enum(['open', 'merged', 'closed']);
export type SubChatPullState = z.infer<typeof subChatPullStateSchema>;

export const subChatFactsSchema = z.object({
  started: z.boolean(),
  archived: z.boolean(),
  needsInput: z.boolean(),
  runStatus: runStatusSchema.nullable(),
  taskQueued: z.boolean(),
  pullRequest: subChatPullStateSchema.nullable(),
  keptChanges: z.boolean(),
});
export type SubChatFacts = z.infer<typeof subChatFactsSchema>;

export const SUB_CHAT_STATUS_WORDS: Record<SubChatStatus, string> = {
  needs_you: 'Needs you',
  working: 'Working',
  held: 'Held',
  ready_for_review: 'Ready for review',
  done: 'Done',
};

export const SUB_CHAT_GROUP_ORDER: readonly SubChatStatus[] = [
  'needs_you',
  'ready_for_review',
  'working',
  'held',
  'done',
];

const ENDED_BADLY: ReadonlySet<RunStatus> = new Set(['failed', 'cancelled', 'outcome_unknown']);
const IN_PROGRESS: ReadonlySet<RunStatus> = new Set(['queued', 'running']);

function needsUser(facts: SubChatFacts): boolean {
  if (facts.needsInput || facts.runStatus === 'awaiting_approval') return true;
  return facts.runStatus !== null && ENDED_BADLY.has(facts.runStatus);
}

function isWorking(facts: SubChatFacts): boolean {
  return facts.taskQueued || (facts.runStatus !== null && IN_PROGRESS.has(facts.runStatus));
}

function hasWorkToReview(facts: SubChatFacts): boolean {
  if (facts.runStatus !== 'succeeded') return false;
  return facts.pullRequest === 'open' || (facts.keptChanges && facts.pullRequest === null);
}

export function subChatStatus(facts: SubChatFacts): SubChatStatus {
  if (!facts.started) return 'held';
  if (needsUser(facts)) return 'needs_you';
  if (isWorking(facts)) return 'working';
  if (facts.archived) return 'done';
  if (hasWorkToReview(facts)) return 'ready_for_review';
  return 'done';
}

import { z } from 'zod';
import { ATTACHMENTS_PER_MESSAGE } from './attachments.ts';
import { involvementLevelSchema } from './involvement-levels.ts';
import { providerIdSchema } from './provider-ids.ts';
import { runStatusSchema } from './runs.ts';
import { SPARK_TEXT_MAX } from './spark-actions.ts';
import {
  OUTPOST_HANDLE_PATTERN,
  OUTPOST_INSTRUCTIONS_MAX,
  OUTPOST_MEMBERS_MAX,
  OUTPOST_NAME_MAX,
  OUTPOST_STORY_TITLE_MAX,
} from './outpost-limits.ts';

export {
  OUTPOST_HANDLE_PATTERN,
  OUTPOST_INSTRUCTIONS_MAX,
  OUTPOST_MEMBERS_MAX,
  OUTPOST_NAME_MAX,
  OUTPOST_STORY_TITLE_MAX,
} from './outpost-limits.ts';

export const outpostNameSchema = z.string().trim().min(1).max(OUTPOST_NAME_MAX);
export const outpostHandleSchema = z.string().regex(OUTPOST_HANDLE_PATTERN);
const postTextSchema = z.string().trim().min(1).max(SPARK_TEXT_MAX);
const storyTitleSchema = z.string().trim().min(1).max(OUTPOST_STORY_TITLE_MAX);

export const requestStateSchema = z.enum([
  'sent',
  'working',
  'needs_you',
  'answered',
  'failed',
  'cancelled',
]);
export type RequestState = z.infer<typeof requestStateSchema>;

export const closedStateSchema = z.enum(['cancelled', 'failed', 'rejected']);
export type ClosedState = z.infer<typeof closedStateSchema>;

export const rejectReasonSchema = z.enum(['queue_full', 'chat_archived', 'not_member']);
export type RejectReason = z.infer<typeof rejectReasonSchema>;

export const requestFactsSchema = z.object({
  toHandle: z.string(),
  closedState: closedStateSchema.nullable(),
  closedReason: z.string().nullable(),
  sent: z.boolean(),
  queued: z.boolean(),
  runStatus: runStatusSchema.nullable(),
  runNeedsYou: z.string().nullable(),
  runAsksQuestion: z.boolean().optional(),
  paused: z.boolean(),
  held: z.enum(['failed', 'stopped']).nullable(),
  chatDeleted: z.boolean(),
  waitingOn: z.string().nullable(),
  waitingOnDeleted: z.boolean().optional(),
  waitingOnFailed: z.boolean().optional(),
});
export type RequestFacts = z.infer<typeof requestFactsSchema>;

export interface DerivedRequestState {
  state: RequestState;
  reason: string | null;
}

export const memberStorySchema = z.object({
  lead: z.uuid().nullable(),
  after: z.uuid().nullable(),
  position: z.number().int(),
});
export type MemberStory = z.infer<typeof memberStorySchema>;

export const outpostMemberSchema = z.object({
  conversationId: z.uuid(),
  handle: outpostHandleSchema,
  position: z.number(),
  joinedAt: z.string(),
  story: memberStorySchema.optional(),
});
export type OutpostMember = z.infer<typeof outpostMemberSchema>;

export const outpostSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  pausedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  members: z.array(outpostMemberSchema),
  instructions: z.string().default(''),
  needsYou: z.number().int().nonnegative(),
});
export type Outpost = z.infer<typeof outpostSchema>;

export const outpostPostKindSchema = z.enum(['request', 'note', 'notice']);
export type OutpostPostKind = z.infer<typeof outpostPostKindSchema>;

export const answerPublishSchema = z.object({
  committed: z.boolean().nullable(),
  pushed: z.boolean().nullable(),
  reason: z.string().nullable(),
});
export type AnswerPublish = z.infer<typeof answerPublishSchema>;

export const outpostAnswerSchema = z.object({
  text: z.string(),
  branch: z.string().nullable(),
  changes: z.array(z.string()),
  pullRequests: z.array(z.string()),
  publish: answerPublishSchema.nullable().optional(),
});
export type OutpostAnswer = z.infer<typeof outpostAnswerSchema>;

export const outpostExchangeSchema = z.object({
  question: z.string(),
  answer: z.string(),
});
export type OutpostExchange = z.infer<typeof outpostExchangeSchema>;

export const outpostIntroSchema = z.object({
  conversationId: z.uuid(),
  task: z.string().nullable(),
});
export type OutpostIntro = z.infer<typeof outpostIntroSchema>;

export const outpostPostSchema = z.object({
  id: z.uuid(),
  outpostId: z.uuid(),
  kind: outpostPostKindSchema,
  body: z.string(),
  fromUser: z.boolean(),
  fromSpark: z.boolean().default(false),
  fromConversationId: z.uuid().nullable(),
  fromRunId: z.uuid().nullable().default(null),
  fromHandle: z.string().nullable(),
  userStarted: z.boolean().default(false),
  agentStarted: z.boolean().default(false),
  toConversationId: z.uuid().nullable(),
  toHandle: z.string().nullable(),
  guest: z.boolean(),
  waits: z.boolean(),
  held: z.boolean().default(false),
  batchId: z.uuid().nullable(),
  taskId: z.uuid().nullable(),
  runId: z.uuid().nullable(),
  pinnedAt: z.string().nullable(),
  createdAt: z.string(),
  state: requestStateSchema.nullable(),
  reason: z.string().nullable(),
  answer: outpostAnswerSchema.nullable(),
  exchanges: z.array(outpostExchangeSchema).default([]),
  files: z.number().int().nonnegative().default(0),
  intro: outpostIntroSchema.nullable().default(null),
});
export type OutpostPost = z.infer<typeof outpostPostSchema>;

export const stackWarningKindSchema = z.enum([
  'behind_parent',
  'base_merged',
  'base_mismatch',
  'parent_not_pushed',
  'parent_failed',
]);
export type StackWarningKind = z.infer<typeof stackWarningKindSchema>;

export const stackWarningSchema = z.object({
  kind: stackWarningKindSchema,
  text: z.string(),
});
export type StackWarning = z.infer<typeof stackWarningSchema>;

export const storyPullStateSchema = z.enum(['open', 'merged', 'closed']);
export type StoryPullState = z.infer<typeof storyPullStateSchema>;

export const storyPullRequestSchema = z.object({
  number: z.number().int().positive(),
  url: z.string(),
  state: storyPullStateSchema,
  draft: z.boolean(),
  base: z.string().nullable(),
});
export type StoryPullRequest = z.infer<typeof storyPullRequestSchema>;

export const storyTaskSchema = z.object({
  conversationId: z.uuid(),
  handle: z.string(),
  title: z.string(),
  position: z.number().int(),
  dependsOn: z.uuid().nullable(),
  dependsOnHandle: z.string().nullable(),
  stacked: z.boolean(),
  openingPostId: z.uuid().nullable(),
  state: requestStateSchema.nullable(),
  reason: z.string().nullable(),
  branch: z.string().nullable(),
  pullRequest: storyPullRequestSchema.nullable(),
  warnings: z.array(stackWarningSchema),
});
export type StoryTask = z.infer<typeof storyTaskSchema>;

export const outpostStorySchema = z.object({
  draftId: z.uuid().nullable(),
  title: z.string().nullable(),
  leadConversationId: z.uuid().nullable(),
  leadHandle: z.string().nullable(),
  tasks: z.array(storyTaskSchema),
});
export type OutpostStory = z.infer<typeof outpostStorySchema>;

export const outpostDetailSchema = z.object({
  outpost: outpostSchema,
  posts: z.array(outpostPostSchema),
  stories: z.array(outpostStorySchema).default([]),
});
export type OutpostDetail = z.infer<typeof outpostDetailSchema>;

export const memberRequestSchema = z.object({
  conversationId: z.uuid(),
  handle: outpostHandleSchema,
});
export type MemberRequest = z.infer<typeof memberRequestSchema>;

export const firstMessageSchema = z.object({
  id: z.uuid(),
  text: postTextSchema,
  attachmentIds: z.array(z.uuid()).max(ATTACHMENTS_PER_MESSAGE).default([]),
});
export type FirstMessage = z.infer<typeof firstMessageSchema>;

export const newMemberChatSchema = z.object({
  conversationId: z.uuid(),
  projectId: z.uuid(),
  provider: providerIdSchema,
  model: z.string().min(1).max(200).nullable(),
  agentMode: z.string().min(1).max(200).nullable(),
  level: involvementLevelSchema.optional(),
});
export type NewMemberChat = z.infer<typeof newMemberChatSchema>;

const existingStartMemberSchema = memberRequestSchema.extend({
  firstMessage: firstMessageSchema.optional(),
  dependsOn: z.uuid().optional(),
});

const newStartMemberSchema = z.object({
  new: newMemberChatSchema,
  handle: outpostHandleSchema,
  firstMessage: firstMessageSchema.optional(),
  dependsOn: z.uuid().optional(),
});

export const startMemberSchema = z.union([existingStartMemberSchema, newStartMemberSchema]);
export type StartMember = z.infer<typeof startMemberSchema>;

export function startMemberChatId(member: StartMember): string {
  return 'new' in member ? member.new.conversationId : member.conversationId;
}

export const createOutpostRequestSchema = z.object({
  id: z.uuid(),
  name: outpostNameSchema,
  members: z.array(startMemberSchema).max(OUTPOST_MEMBERS_MAX),
  draftId: z.uuid().optional(),
});
export type CreateOutpostRequest = z.infer<typeof createOutpostRequestSchema>;

export const failedMemberSchema = z.object({
  conversationId: z.uuid(),
  handle: z.string(),
  message: z.string(),
});
export type FailedMember = z.infer<typeof failedMemberSchema>;

export const startDraftResponseSchema = z.object({
  outpostId: z.uuid(),
  message: z.string(),
  failed: z.array(failedMemberSchema).default([]),
});
export type StartDraftResponse = z.infer<typeof startDraftResponseSchema>;

export const createOutpostResponseSchema = outpostDetailSchema.extend({
  failed: z.array(failedMemberSchema).default([]),
});
export type CreateOutpostResponse = z.infer<typeof createOutpostResponseSchema>;

export const updateOutpostRequestSchema = z
  .object({
    name: outpostNameSchema.optional(),
    paused: z.boolean().optional(),
  })
  .refine((update) => update.name !== undefined || update.paused !== undefined, {
    message: 'Change the name or pause the outpost.',
  });
export type UpdateOutpostRequest = z.infer<typeof updateOutpostRequestSchema>;

export const outpostInstructionsRequestSchema = z.object({
  instructions: z.string().trim().max(OUTPOST_INSTRUCTIONS_MAX),
});
export type OutpostInstructionsRequest = z.infer<typeof outpostInstructionsRequestSchema>;

export const createPostRequestSchema = z.object({
  id: z.uuid(),
  text: postTextSchema,
  to: z.array(z.string().min(1).max(64)).max(OUTPOST_MEMBERS_MAX).optional(),
  guestConversationId: z.uuid().optional(),
});
export type CreatePostRequest = z.infer<typeof createPostRequestSchema>;

export const pinPostRequestSchema = z.object({ pinned: z.boolean() });
export type PinPostRequest = z.infer<typeof pinPostRequestSchema>;

export const draftChatSchema = z.object({
  handle: outpostHandleSchema,
  title: storyTitleSchema,
  projectId: z.uuid(),
  agent: providerIdSchema.optional(),
  agentMode: z.string().min(1).max(200).optional(),
  task: postTextSchema,
  dependsOn: outpostHandleSchema.optional(),
});
export type DraftChat = z.infer<typeof draftChatSchema>;

export const outpostDraftSchema = z.object({
  name: outpostNameSchema.optional(),
  title: storyTitleSchema,
  chats: z.array(draftChatSchema).min(1).max(OUTPOST_MEMBERS_MAX),
});
export type OutpostDraft = z.infer<typeof outpostDraftSchema>;

export const chatDraftSchema = z.object({
  id: z.uuid(),
  runId: z.uuid().nullable(),
  chats: z.number().int().positive(),
  stacked: z.number().int().nonnegative(),
  outpostId: z.uuid().nullable(),
  startedAt: z.string().nullable(),
});
export type ChatDraft = z.infer<typeof chatDraftSchema>;

export const chatDraftsSchema = z.object({ drafts: z.array(chatDraftSchema) });
export type ChatDrafts = z.infer<typeof chatDraftsSchema>;

export type PostAddress =
  | { kind: 'request'; to: string; body: string }
  | { kind: 'all'; body: string }
  | { kind: 'note'; body: string };

export interface BatchLine {
  post: OutpostPost;
  handle: string;
}

export type ThreadItem =
  | { kind: 'request'; post: OutpostPost }
  | { kind: 'batch'; batchId: string; body: string; createdAt: string; lines: BatchLine[] }
  | { kind: 'note'; post: OutpostPost }
  | { kind: 'notice'; post: OutpostPost };

export type HandleProblem = (handle: string, taken: readonly string[]) => string | null;
export type SuggestHandle = (name: string, taken: readonly string[]) => string;
export type ParseAddress = (text: string, handles: readonly string[]) => PostAddress;
export type RequestStateOf = (facts: RequestFacts) => DerivedRequestState;
export type ThreadItems = (posts: readonly OutpostPost[]) => ThreadItem[];
export type PinnedNotes = (posts: readonly OutpostPost[]) => OutpostPost[];
export type NeedsYouCount = (posts: readonly OutpostPost[]) => number;

import { z } from 'zod';
import { providerIdSchema } from './provider-ids.ts';
import { runStatusSchema } from './runs.ts';
import { SPARK_TEXT_MAX } from './spark-actions.ts';

export const OUTPOST_NAME_MAX = 60;
export const OUTPOST_HANDLE_PATTERN = /^[a-z][a-z0-9-]{1,15}$/;
export const OUTPOST_MEMBERS_MAX = 50;

export const outpostNameSchema = z.string().trim().min(1).max(OUTPOST_NAME_MAX);
export const outpostHandleSchema = z.string().regex(OUTPOST_HANDLE_PATTERN);
const postTextSchema = z.string().trim().min(1).max(SPARK_TEXT_MAX);

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
  paused: z.boolean(),
  held: z.boolean(),
  chatDeleted: z.boolean(),
});
export type RequestFacts = z.infer<typeof requestFactsSchema>;

export interface DerivedRequestState {
  state: RequestState;
  reason: string | null;
}

export const outpostMemberSchema = z.object({
  conversationId: z.uuid(),
  handle: outpostHandleSchema,
  position: z.number(),
  joinedAt: z.string(),
});
export type OutpostMember = z.infer<typeof outpostMemberSchema>;

export const outpostSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  pausedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  members: z.array(outpostMemberSchema),
  needsYou: z.number().int().nonnegative(),
});
export type Outpost = z.infer<typeof outpostSchema>;

export const outpostPostKindSchema = z.enum(['request', 'note', 'notice']);
export type OutpostPostKind = z.infer<typeof outpostPostKindSchema>;

export const outpostAnswerSchema = z.object({
  text: z.string(),
  branch: z.string().nullable(),
  changes: z.array(z.string()),
  pullRequests: z.array(z.string()),
});
export type OutpostAnswer = z.infer<typeof outpostAnswerSchema>;

export const outpostPostSchema = z.object({
  id: z.uuid(),
  outpostId: z.uuid(),
  kind: outpostPostKindSchema,
  body: z.string(),
  fromUser: z.boolean(),
  fromConversationId: z.uuid().nullable(),
  fromHandle: z.string().nullable(),
  toConversationId: z.uuid().nullable(),
  toHandle: z.string().nullable(),
  guest: z.boolean(),
  waits: z.boolean(),
  batchId: z.uuid().nullable(),
  taskId: z.uuid().nullable(),
  runId: z.uuid().nullable(),
  pinnedAt: z.string().nullable(),
  createdAt: z.string(),
  state: requestStateSchema.nullable(),
  reason: z.string().nullable(),
  answer: outpostAnswerSchema.nullable(),
});
export type OutpostPost = z.infer<typeof outpostPostSchema>;

export const outpostDetailSchema = z.object({
  outpost: outpostSchema,
  posts: z.array(outpostPostSchema),
});
export type OutpostDetail = z.infer<typeof outpostDetailSchema>;

export const memberRequestSchema = z.object({
  conversationId: z.uuid(),
  handle: outpostHandleSchema,
});
export type MemberRequest = z.infer<typeof memberRequestSchema>;

export const createOutpostRequestSchema = z.object({
  id: z.uuid(),
  name: outpostNameSchema,
  members: z.array(memberRequestSchema).max(OUTPOST_MEMBERS_MAX),
});
export type CreateOutpostRequest = z.infer<typeof createOutpostRequestSchema>;

export const updateOutpostRequestSchema = z
  .object({
    name: outpostNameSchema.optional(),
    paused: z.boolean().optional(),
  })
  .refine((update) => update.name !== undefined || update.paused !== undefined, {
    message: 'Change the name or pause the outpost.',
  });
export type UpdateOutpostRequest = z.infer<typeof updateOutpostRequestSchema>;

export const createPostRequestSchema = z.object({
  id: z.uuid(),
  text: postTextSchema,
  guestConversationId: z.uuid().optional(),
});
export type CreatePostRequest = z.infer<typeof createPostRequestSchema>;

export const pinPostRequestSchema = z.object({ pinned: z.boolean() });
export type PinPostRequest = z.infer<typeof pinPostRequestSchema>;

const draftMemberSchema = z
  .object({
    handle: outpostHandleSchema,
    conversationId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    agent: providerIdSchema.optional(),
  })
  .refine((member) => (member.conversationId === undefined) !== (member.projectId === undefined), {
    message: 'Name an existing chat or a project for a new chat, not both.',
  });

export const outpostDraftSchema = z.object({
  name: outpostNameSchema,
  members: z.array(draftMemberSchema).min(1).max(OUTPOST_MEMBERS_MAX),
  requests: z.array(z.object({ to: outpostHandleSchema, text: postTextSchema })),
});
export type OutpostDraft = z.infer<typeof outpostDraftSchema>;

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

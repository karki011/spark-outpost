import { z } from 'zod';
import { chatRefSchema } from './chat-ref.ts';
import { involvementLevelSchema } from './involvement-levels.ts';
import { prChecksSchema } from './pr-follow-up.ts';
import {
  SUB_CHAT_TASK_MAX,
  SUB_CHAT_TITLE_MAX,
  subChatsStartedActivitySchema,
} from './start-sub-chats-action.ts';
import { subChatPullStateSchema, subChatStatusSchema } from './sub-chat-status.ts';

const pieceTitle = z.string().trim().min(1).max(SUB_CHAT_TITLE_MAX);
const pieceChoice = z.string().trim().min(1).max(200);

export const subChatPieceSchema = z.object({
  title: pieceTitle,
  task: z.string().trim().min(1).max(SUB_CHAT_TASK_MAX),
  project: pieceChoice.optional(),
  agent: pieceChoice.optional(),
  model: pieceChoice.optional(),
  effort: pieceChoice.optional(),
  mode: pieceChoice.optional(),
  autonomy: involvementLevelSchema.optional(),
  stackedOn: pieceTitle.optional(),
  startsAfter: z.array(pieceTitle).default([]),
});
export type SubChatPiece = z.infer<typeof subChatPieceSchema>;

export const subChatStartedWithSchema = z.object({
  provider: z.string(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  agentMode: z.string().nullable(),
  level: involvementLevelSchema.nullable(),
});
export type SubChatStartedWith = z.infer<typeof subChatStartedWithSchema>;

export const subChatPullRequestSchema = z.object({
  number: z.number().int().positive(),
  url: z.string(),
  state: subChatPullStateSchema,
  checks: prChecksSchema,
});
export type SubChatPullRequest = z.infer<typeof subChatPullRequestSchema>;

export const subChatReportSchema = z.object({
  status: subChatStatusSchema,
  reason: z.string().nullable(),
  changed: z.string(),
  risks: z.string(),
  blockers: z.string(),
  branch: z.string().nullable(),
  committed: z.boolean(),
  pushed: z.boolean(),
  pullRequest: subChatPullRequestSchema.nullable(),
});
export type SubChatReport = z.infer<typeof subChatReportSchema>;

export const NONE_STATED = 'None stated';
export const REPORT_FOOTER =
  "Written by the sub-chat's agent, not checked by Spark. The branch and pull request line is Spark's own record.";

export const subChatRowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  position: z.number().int().nonnegative(),
  status: subChatStatusSchema,
  why: z.string().nullable(),
  task: z.string(),
  branch: z.string().nullable(),
  pullRequest: subChatPullRequestSchema.nullable(),
  startedWith: subChatStartedWithSchema,
  stackedOn: chatRefSchema.nullable(),
  startsAfter: z.array(chatRefSchema),
  startedAt: z.string().nullable(),
  report: subChatReportSchema.nullable(),
  reportedAt: z.string().nullable(),
});
export type SubChatRow = z.infer<typeof subChatRowSchema>;

export const subChatsResponseSchema = z.object({ subChats: z.array(subChatRowSchema) });
export type SubChatsResponse = z.infer<typeof subChatsResponseSchema>;

export const subChatsStartSchema = subChatsStartedActivitySchema.extend({ runId: z.uuid() });
export type SubChatsStart = z.infer<typeof subChatsStartSchema>;

export const subChatLinkSchema = z.object({
  position: z.number().int().nonnegative(),
  status: subChatStatusSchema,
});
export type SubChatLink = z.infer<typeof subChatLinkSchema>;

export const formerParentSchema = z.object({ title: z.string() });

export const chatAskKindSchema = z.enum(['task', 'message', 'reply', 'report', 'wrap_up']);
export type ChatAskKind = z.infer<typeof chatAskKindSchema>;

export const chatAskStateSchema = z.enum(['waiting', 'replied', 'no_reply']);
export type ChatAskState = z.infer<typeof chatAskStateSchema>;

export const chatAskDeliverySchema = z.enum(['turn', 'steer']);
export type ChatAskDelivery = z.infer<typeof chatAskDeliverySchema>;

export const chatAskSchema = z.object({
  id: z.uuid(),
  kind: chatAskKindSchema,
  from: z.object({ id: z.uuid().nullable(), title: z.string() }),
  fromRunId: z.uuid().nullable(),
  to: chatRefSchema,
  body: z.string(),
  replyTo: z.uuid().nullable(),
  state: chatAskStateSchema.nullable(),
  deliveredAs: chatAskDeliverySchema.nullable(),
  runId: z.uuid().nullable(),
  noReplyReason: z.string().nullable(),
  report: subChatReportSchema.nullable(),
  createdAt: z.string(),
  settledAt: z.string().nullable(),
});
export type ChatAsk = z.infer<typeof chatAskSchema>;

const ASK_STATE_WORDS: Record<ChatAskState, string> = {
  waiting: 'Waiting',
  replied: 'Replied',
  no_reply: 'No reply',
};

const FIRST_LINE_MAX = 120;

function firstLine(text: string): string {
  const line = (text.trim().split('\n')[0] ?? '').trim();
  return line.length <= FIRST_LINE_MAX ? line : `${line.slice(0, FIRST_LINE_MAX - 1).trimEnd()}…`;
}

export function startedSubChatsLine(titles: readonly string[]): string {
  const noun = titles.length === 1 ? 'sub-chat' : 'sub-chats';
  return `Started ${titles.length} ${noun}: ${titles.join(', ')}`;
}

export function sentToChatLine(chat: string, body: string, state: ChatAskState | null): string {
  if (state === null) return `Sent to ${chat}: ${firstLine(body)}`;
  return `Asked ${chat}: ${firstLine(body)} · ${ASK_STATE_WORDS[state]}`;
}

export function fromChatLine(chat: string, body: string): string {
  return `From ${chat}: ${firstLine(body)}`;
}

export function exchangesLine(count: number, chat: string): string {
  return `${count} ${count === 1 ? 'exchange' : 'exchanges'} with ${chat}`;
}

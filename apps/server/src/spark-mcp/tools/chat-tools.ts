import { z } from 'zod';
import {
  autonomyLabel,
  CONVERSATION_SEARCH_MAX_LENGTH,
  type ConversationSummary,
  type Run,
} from '@spark-outpost/contracts';
import { resolveChatSettings } from '../../persistence/chat-settings.ts';
import { primaryChatWorktree } from '../../persistence/chat-worktrees.ts';
import { getConversationDetail, listConversations } from '../../persistence/conversations.ts';
import { listProjects } from '../../projects/projects.ts';
import type { SparkScope } from '../deps.ts';
import { page, round } from '../format.ts';
import {
  limitInput,
  offsetInput,
  sparkTool,
  SparkToolError,
  type SparkToolContext,
} from '../tool.ts';
import { findProject } from './project-tools.ts';

const CHAT_STATES = ['working', 'needs_you', 'failed', 'done', 'idle'] as const;
type ChatState = (typeof CHAT_STATES)[number];

function chatState(chat: ConversationSummary): ChatState {
  if (chat.needsInput || chat.attention) return 'needs_you';
  const status = chat.latestRun?.status;
  if (status === 'queued' || status === 'running' || status === 'awaiting_approval') {
    return 'working';
  }
  if (status === 'failed' || status === 'outcome_unknown') return 'failed';
  if (status === 'succeeded' || status === 'cancelled') return 'done';
  return 'idle';
}

export function chatIdFor(scope: SparkScope, requested: string | undefined): string {
  const id = requested ?? scope.conversationId;
  if (!id) throw new SparkToolError('Pass a chat id; this session has no chat of its own.');
  return id;
}

async function chats(
  context: SparkToolContext,
  args: {
    query?: string | undefined;
    project?: string | undefined;
    state?: ChatState | undefined;
    includeArchived: boolean;
    limit: number;
    offset: number;
  },
) {
  const { deps, scope } = context;
  const project = args.project ? await findProject(context, args.project) : null;
  const [all, projects] = await Promise.all([
    listConversations(deps.db, scope.workspaceId, args.query ?? ''),
    listProjects(deps.db, scope.workspaceId),
  ]);
  const names = new Map(projects.map((entry) => [entry.id, entry.name]));
  const matching = all.filter(
    (chat) =>
      (args.includeArchived || chat.archivedAt === null) &&
      (!project || chat.projectIds.includes(project.id)) &&
      (!args.state || chatState(chat) === args.state),
  );
  const shown = page(matching, args.offset, args.limit);
  const items = await Promise.all(
    shown.items.map(async (chat) => {
      const settings = await resolveChatSettings(deps.db, chat.id).catch(() => null);
      return {
        id: chat.id,
        title: chat.title,
        projects: chat.projectIds.map((id) => names.get(id) ?? id),
        updatedAt: chat.updatedAt,
        state: chatState(chat),
        ...(chat.attention ? { waitingOn: `${chat.attention.kind}: ${chat.attention.title}` } : {}),
        ...(chat.latestRun?.error ? { error: chat.latestRun.error } : {}),
        provider: settings?.provider ?? chat.latestRun?.provider ?? null,
        model: settings?.model ?? null,
        agentMode: settings?.agentMode ?? null,
        autonomy: settings?.level ? autonomyLabel(settings.level) : null,
        category: chat.category,
        ...(chat.branch ? { branch: chat.branch } : {}),
        ...(chat.pinnedAt ? { pinned: true } : {}),
        ...(chat.archivedAt ? { archived: true } : {}),
        ...(chat.id === scope.conversationId ? { thisChat: true } : {}),
      };
    }),
  );
  return { ...shown, items };
}

function runLine(run: Run) {
  return {
    id: run.id,
    status: run.status,
    provider: run.provider,
    model: run.model,
    mode: run.mode,
    ...(run.role ? { role: run.role } : {}),
    ...(run.agentLabel ? { agent: run.agentLabel } : {}),
    ...(run.level ? { autonomy: autonomyLabel(run.level) } : {}),
    ...(run.error ? { error: run.error } : {}),
    costUsd: round(run.usage?.costUsd),
    ...(run.revertedAt ? { reverted: true } : {}),
    createdAt: run.createdAt,
  };
}

const RUNS_SHOWN = 30;

async function chat(
  { deps, scope }: SparkToolContext,
  args: { chat?: string | undefined; offset?: number | undefined; limit: number; maxChars: number },
) {
  const id = chatIdFor(scope, args.chat);
  const detail = await getConversationDetail(deps.db, id);
  if (!detail || !(await inWorkspace(deps.db, scope.workspaceId, id))) {
    throw new SparkToolError('That chat does not exist.');
  }
  const { conversation, messages, runs, settings, approvals } = detail;
  const tree = await primaryChatWorktree(deps.db, id);
  const offset = args.offset ?? Math.max(0, messages.length - args.limit);
  const shown = page(messages, offset, args.limit);
  return {
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    state: chatState(conversation),
    settings: {
      provider: settings.provider,
      model: settings.model,
      effort: settings.effort,
      agentMode: settings.agentMode,
      autonomy: settings.level ? autonomyLabel(settings.level) : null,
    },
    costUsd: round(detail.usageTotals.costUsd),
    workspace: tree
      ? {
          branch: tree.branch,
          from: tree.baseBranch,
          where: tree.inPlace ? 'in the checkout' : 'its own worktree',
          path: tree.path,
          ...(tree.landedCommit ? { broughtIntoCheckout: true } : {}),
        }
      : null,
    messages: {
      ...shown,
      ...(offset > 0 ? { earlierFrom: Math.max(0, offset - args.limit) } : {}),
      items: shown.items.map((message) => ({
        role: message.role,
        at: message.createdAt,
        text:
          message.content.length > args.maxChars
            ? `${message.content.slice(0, args.maxChars)}… (${message.content.length} chars)`
            : message.content,
        ...(message.attachments.length > 0
          ? { attachments: message.attachments.map((attachment) => attachment.name) }
          : {}),
      })),
    },
    runs: { total: runs.length, latest: runs.slice(-RUNS_SHOWN).map(runLine) },
    approvals: approvals.slice(-RUNS_SHOWN).map((approval) => ({
      kind: approval.kind,
      title: approval.title,
      status: approval.status,
      decidedBy: approval.decidedBy,
    })),
  };
}

async function inWorkspace(
  db: SparkToolContext['deps']['db'],
  workspaceId: string,
  conversationId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    'SELECT 1 FROM conversations WHERE id = $1 AND workspace_id = $2',
    [conversationId, workspaceId],
  );
  return rowCount === 1;
}

const chatIdInput = z
  .uuid()
  .optional()
  .describe('Chat id from spark_chats. Defaults to this chat.');

export const chatTools = [
  sparkTool({
    name: 'spark_chats',
    privateData: true,
    title: 'Chats',
    description:
      'List or search Spark chats (title and message text): title, projects, last update, state (working, needs_you, failed, done, idle), provider, model, mode and autonomy. Newest first, paged.',
    input: {
      query: z
        .string()
        .max(CONVERSATION_SEARCH_MAX_LENGTH)
        .optional()
        .describe('Text to find in titles or messages.'),
      project: z.string().max(200).optional().describe('Only chats in this project (name or id).'),
      state: z.enum(CHAT_STATES).optional(),
      includeArchived: z.boolean().default(false),
      limit: limitInput(20, 50),
      offset: offsetInput,
    },
    run: (args, context) => chats(context, args),
  }),
  sparkTool({
    name: 'spark_chat',
    privateData: true,
    title: 'Read a chat',
    description:
      'Read one chat: settings, cost, its branch and worktree, messages (the latest page by default; pass offset for earlier ones), its runs (status, provider, model, role, errors, cost) and approval cards. Defaults to this chat. Long messages are cut to maxChars; secrets are redacted.',
    input: {
      chat: chatIdInput,
      offset: z.number().int().min(0).optional().describe('First message to show (0 = oldest).'),
      limit: limitInput(12, 40),
      maxChars: z.number().int().min(200).max(6000).default(1500),
    },
    run: (args, context) => chat(context, args),
  }),
];

export { chatIdInput, chatState, inWorkspace };

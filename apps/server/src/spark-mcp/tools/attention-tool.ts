import {
  approvalAttentionKey,
  asideItem,
  freshUpdate,
  waitingOnYou,
  type ApprovalKind,
  type ApprovalOption,
  type AttentionItem,
} from '@spark-outpost/contracts';
import { listAttentionItems } from '../../persistence/attention-items.ts';
import { attentionSnapshot } from '../../persistence/attention-settings.ts';
import { listConversations } from '../../persistence/conversations.ts';
import { nowOf } from '../deps.ts';
import { limitInput, sparkTool, type SparkToolContext } from '../tool.ts';
import { chatState } from './chat-tools.ts';

interface PendingRow {
  id: string;
  kind: ApprovalKind;
  title: string;
  command: string | null;
  options: ApprovalOption[];
  created_at: Date;
  auto_continue_at: Date | null;
  run_id: string;
  role: string | null;
  agent: string | null;
  provider: string;
  chat_id: string;
  chat_title: string;
}

async function pendingCards({ deps, scope }: SparkToolContext): Promise<PendingRow[]> {
  const { rows } = await deps.db.query<PendingRow>(
    `SELECT a.id, a.kind, a.title, a.payload->>'command' AS command, a.options, a.created_at,
       a.auto_continue_at, r.id AS run_id, r.role, COALESCE(r.route->>'name', r.agent_label) AS agent,
       r.provider, c.id AS chat_id, c.title AS chat_title
     FROM approvals a
     JOIN runs r ON r.id = a.run_id
     JOIN conversations c ON c.id = r.conversation_id
     WHERE c.workspace_id = $1 AND a.status = 'pending' AND c.archived_at IS NULL
       AND c.kind <> 'crew'
     ORDER BY a.created_at`,
    [scope.workspaceId],
  );
  return rows;
}

function cardLine(row: PendingRow, now: Date) {
  return {
    chat: { id: row.chat_id, title: row.chat_title },
    kind: row.kind,
    asks: row.title,
    ...(row.command ? { command: row.command } : {}),
    from: row.agent ?? row.provider,
    ...(row.role ? { role: row.role } : {}),
    run: row.run_id,
    waitingMinutes: Math.max(0, Math.round((now.getTime() - row.created_at.getTime()) / 60_000)),
    ...(row.auto_continue_at ? { autoContinuesAt: row.auto_continue_at.toISOString() } : {}),
    choices: row.options.map((option) => option.name),
  };
}

function updateLine(item: AttentionItem, titles: ReadonlyMap<string, string>) {
  return {
    chat: { id: item.conversationId, title: titles.get(item.conversationId) ?? '' },
    kind: item.kind,
    ...(item.detail && item.kind !== 'shell-alert' ? { detail: item.detail } : {}),
    at: item.at,
  };
}

async function attention(context: SparkToolContext, limit: number) {
  const { deps, scope } = context;
  const [pending, chats, flagged, items] = await Promise.all([
    pendingCards(context),
    listConversations(deps.db, scope.workspaceId, ''),
    attentionSnapshot(deps.db, scope.workspaceId),
    listAttentionItems(deps.db, scope.workspaceId),
  ]);
  const now = nowOf(deps);
  const waiting = items.filter(waitingOnYou);
  const waitingKeys = new Set(waiting.map((item) => item.key));
  const cards = pending.filter((row) => waitingKeys.has(approvalAttentionKey(row.id)));
  const asideKeys = new Set(items.filter(asideItem).map((item) => item.key));
  const aside = pending.filter((row) => asideKeys.has(approvalAttentionKey(row.id)));
  const titles = new Map(chats.map((chat) => [chat.id, chat.title]));
  const updates = items.filter(freshUpdate);
  const terminals = waiting.filter((item) => item.kind === 'terminal').length;
  const failed = chats.filter((chat) => chat.archivedAt === null && chatState(chat) === 'failed');
  return {
    needsYou: waiting.length > 0,
    ...(terminals > 0 ? { terminalsWaiting: terminals } : {}),
    pendingCards: cards.slice(0, limit).map((row) => cardLine(row, now)),
    ...(cards.length > limit ? { morePendingCards: cards.length - limit } : {}),
    ...(aside.length > 0
      ? { setAsideCards: aside.slice(0, limit).map((row) => cardLine(row, now)) }
      : {}),
    failedChats: failed.slice(0, limit).map((chat) => ({
      id: chat.id,
      title: chat.title,
      error: chat.latestRun?.error ?? null,
      updatedAt: chat.updatedAt,
    })),
    updates: updates.slice(0, limit).map((item) => updateLine(item, titles)),
    flaggedTickets: flagged.items.slice(0, limit),
    note: 'Answer cards in the chat they belong to; Spark tools cannot approve or deny them.',
  };
}

export const attentionTool = sparkTool({
  name: 'spark_attention',
  privateData: true,
  title: 'What needs you',
  description:
    'Does anyone need anything? needsYou is true only when something blocks on the user: cards waiting in any chat (permission, questions, plans, checkpoints, Spark actions) not set aside, with chat, asker, wait and choices, or a waiting Terminal session. setAsideCards: put off with Later, still unanswered, never in needsYou; call them set aside. Also unread updates (Spark flags, finished and failed turns), failed chats and flagged tickets, which never set needsYou. Oldest first.',
  input: { limit: limitInput(20, 50) },
  run: (args, context) => attention(context, args.limit),
});

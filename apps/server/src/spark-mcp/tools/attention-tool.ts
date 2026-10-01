import type { ApprovalKind, ApprovalOption } from '@spark-outpost/contracts';
import { attentionSnapshot } from '../../persistence/attention-settings.ts';
import { listConversations } from '../../persistence/conversations.ts';
import { nowOf } from '../deps.ts';
import { limitInput, sparkTool, type SparkToolContext } from '../tool.ts';
import { chatState } from './chat-tools.ts';

interface PendingRow {
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
    `SELECT a.kind, a.title, a.payload->>'command' AS command, a.options, a.created_at,
       a.auto_continue_at, r.id AS run_id, r.role, COALESCE(r.route->>'name', r.agent_label) AS agent,
       r.provider, c.id AS chat_id, c.title AS chat_title
     FROM approvals a
     JOIN runs r ON r.id = a.run_id
     JOIN conversations c ON c.id = r.conversation_id
     WHERE c.workspace_id = $1 AND a.status = 'pending' AND c.archived_at IS NULL
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

async function attention(context: SparkToolContext, limit: number) {
  const { deps, scope } = context;
  const [cards, chats, flagged] = await Promise.all([
    pendingCards(context),
    listConversations(deps.db, scope.workspaceId, ''),
    attentionSnapshot(deps.db, scope.workspaceId),
  ]);
  const now = nowOf(deps);
  const failed = chats.filter((chat) => chat.archivedAt === null && chatState(chat) === 'failed');
  return {
    needsYou: cards.length + failed.length + flagged.items.length > 0,
    pendingCards: cards.slice(0, limit).map((row) => cardLine(row, now)),
    ...(cards.length > limit ? { morePendingCards: cards.length - limit } : {}),
    failedChats: failed.slice(0, limit).map((chat) => ({
      id: chat.id,
      title: chat.title,
      error: chat.latestRun?.error ?? null,
      updatedAt: chat.updatedAt,
    })),
    flaggedTickets: flagged.items.slice(0, limit),
    note: 'Answer cards in the chat they belong to; Spark tools cannot approve or deny them.',
  };
}

export const attentionTool = sparkTool({
  name: 'spark_attention',
  privateData: true,
  title: 'What needs you',
  description:
    'Does anyone need anything? Every card waiting for the user across all chats (permission to run or edit, clarifying questions, plans, pieces, checkpoints, Spark action cards) with the chat, who asks, how long it has waited and the choices; chats whose last run failed; and tickets flagged for attention. Oldest first.',
  input: { limit: limitInput(20, 50) },
  run: (args, context) => attention(context, args.limit),
});

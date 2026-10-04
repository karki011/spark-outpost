import { z } from 'zod';
import { CONVERSATION_SEARCH_MAX_LENGTH } from '@spark-outpost/contracts';
import { listCompactions } from '../../persistence/compactions.ts';
import { limitInput, sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { CHAT_NOT_FOUND } from '../../chat-share/digest.ts';
import { chatIdFor, chatIdInput, inWorkspace, quotedFrom } from './chat-tools.ts';

interface HistoryRow {
  role: 'user' | 'assistant';
  content: string;
  created_at: Date;
}

interface HistoryArgs {
  chat?: string | undefined;
  from?: number | undefined;
  to?: number | undefined;
  query?: string | undefined;
  limit: number;
  maxChars: number;
  summaries: boolean;
}

function clipped(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}… (${text.length} chars)` : text;
}

function inRange(index: number, args: HistoryArgs): boolean {
  return (
    (args.from === undefined || index >= args.from) && (args.to === undefined || index <= args.to)
  );
}

async function history({ deps, scope }: SparkToolContext, args: HistoryArgs) {
  const id = chatIdFor(scope, args.chat);
  if (!(await inWorkspace(deps.db, scope.workspaceId, id))) {
    throw new SparkToolError(CHAT_NOT_FOUND);
  }
  const { rows } = await deps.db.query<HistoryRow>(
    `SELECT role, content, created_at FROM messages WHERE conversation_id = $1
     ORDER BY created_at, id`,
    [id],
  );
  const needle = args.query?.trim().toLowerCase() ?? '';
  const matching = rows
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => inRange(index, args))
    .filter(({ row }) => !needle || row.content.toLowerCase().includes(needle));
  const shown = matching.slice(0, args.limit);
  const last = shown.at(-1);
  const compactions = args.summaries ? await listCompactions(deps.db, id) : [];
  return {
    ...quotedFrom(scope, id),
    chat: id,
    totalTurns: rows.length,
    matched: matching.length,
    turns: shown.map(({ row, index }) => ({
      turn: index,
      role: row.role,
      at: row.created_at.toISOString(),
      text: clipped(row.content, args.maxChars),
    })),
    ...(last && matching.length > shown.length ? { nextFrom: last.index + 1 } : {}),
    compactions: compactions.map((compaction) => ({
      method: compaction.method,
      at: compaction.createdAt,
      tokensBefore: compaction.tokensBefore,
      tokensAfter: compaction.tokensAfter,
      ...(compaction.fromConversationId ? { fromChat: compaction.fromConversationId } : {}),
      ...(compaction.summary ? { summary: clipped(compaction.summary, args.maxChars) } : {}),
    })),
  };
}

export const historyTool = sparkTool({
  name: 'spark_chat_history',
  privateData: true,
  title: 'Chat history',
  description:
    "Read a chat's full transcript, including turns compacted out of the agent's context: a range of turns (from and to, 0 = oldest, inclusive), or turns whose text contains query. Also lists the chat's compactions (agent /compact, Spark summary or the agent compacting itself) with tokens before and after and the summary text. Defaults to this chat; chat also takes another chat's id or chat link (read-only, quoted data). Page with from and nextFrom. Long text is cut to maxChars; secrets are redacted.",
  input: {
    chat: chatIdInput,
    from: z.number().int().min(0).optional().describe('First turn to return (0 = oldest).'),
    to: z.number().int().min(0).optional().describe('Last turn to return, inclusive.'),
    query: z
      .string()
      .max(CONVERSATION_SEARCH_MAX_LENGTH)
      .optional()
      .describe('Only turns whose text contains this (case-insensitive).'),
    limit: limitInput(20, 50),
    maxChars: z.number().int().min(200).max(8000).default(2000),
    summaries: z.boolean().default(true).describe('Include the compaction summaries.'),
  },
  run: (args, context) => history(context, args),
});

import { z } from 'zod';
import {
  browserOrigin,
  originAndPath,
  parseBrowserUrl,
  type BrowserPlace,
} from '@spark-outpost/contracts';
import { BrowserHostError, type BrowserHost } from '../../../browser/host-client.ts';
import type { Queryable } from '../../../persistence/db.ts';
import { SparkToolError, type SparkToolContext } from '../../tool.ts';

export const tabInput = z
  .string()
  .max(40)
  .optional()
  .describe('Tab id from spark_browser_tabs; default: your last tab.');

export interface BrowserPlaceOfChat {
  chatId: string;
  runId: string | null;
}

export interface BrowserSession extends BrowserPlaceOfChat {
  host: BrowserHost;
}

export function browserSession(context: SparkToolContext): BrowserSession {
  const host = context.deps.browser;
  if (!host) {
    throw new SparkToolError('The browser is only available in the Spark Outpost Mac app.');
  }
  if (!context.scope.conversationId) {
    throw new SparkToolError('The browser belongs to a chat, and this session has none.');
  }
  return { host, chatId: context.scope.conversationId, runId: context.scope.runId };
}

export interface ChatHome {
  projectId: string | null;
  roots: string[];
}

export async function chatHome(db: Queryable, conversationId: string): Promise<ChatHome> {
  const { rows } = await db.query<{ id: string; root_path: string }>(
    `SELECT p.id, p.root_path
     FROM conversation_projects cp JOIN projects p ON p.id = cp.project_id
     WHERE cp.conversation_id = $1 ORDER BY cp.position, cp.created_at`,
    [conversationId],
  );
  const worktrees = await db.query<{ path: string }>(
    'SELECT path FROM chat_worktrees WHERE conversation_id = $1 AND removed_at IS NULL',
    [conversationId],
  );
  const first = rows[0];
  return {
    projectId: first?.id ?? null,
    roots: [...rows.map((row) => row.root_path), ...worktrees.rows.map((row) => row.path)].slice(
      0,
      16,
    ),
  };
}

export type BrowserDecision =
  | 'local'
  | 'mode'
  | 'allowed_earlier'
  | 'user_allowed'
  | 'waiting_for_user'
  | 'user_declined'
  | 'refused'
  | 'refused_origin'
  | 'failed';

export interface BrowserAuditEntry {
  tool: string;
  action: string;
  page: string | null;
  place: BrowserPlace | null;
  decision: BrowserDecision;
  detail?: Record<string, unknown>;
}

export function auditBrowser(context: SparkToolContext, entry: BrowserAuditEntry): void {
  context.scope.actions?.audit?.message('harness', {
    method: 'spark/browser',
    params: {
      tool: entry.tool,
      runId: context.scope.runId,
      action: entry.action,
      page: entry.page === null ? null : originAndPath(entry.page),
      place: entry.place,
      decision: entry.decision,
      ...entry.detail,
    },
  });
}

export function pageParts(url: string): { origin: string; path: string } {
  const parsed = parseBrowserUrl(url);
  return {
    origin: browserOrigin(url) ?? 'about:blank',
    path: (parsed?.pathname ?? '').slice(0, 500),
  };
}

const HOST_MESSAGES: Partial<Record<BrowserHostError['code'], string>> = {
  timeout: 'The browser took too long to answer. Try again.',
  cancelled: 'The browser call was cancelled.',
  invalid: 'The browser sent an answer Spark cannot read.',
};

export function asToolError(error: unknown): Error {
  if (!(error instanceof BrowserHostError)) return error as Error;
  return new SparkToolError(HOST_MESSAGES[error.code] ?? error.message);
}

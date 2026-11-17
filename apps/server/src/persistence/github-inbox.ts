import type { GithubInboxTicket, GithubInboxWindowDays } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export interface SeenMark {
  headSha: string;
  seenAt: Date;
}

export async function inboxWindowDays(
  db: Queryable,
  workspaceId: string,
): Promise<GithubInboxWindowDays> {
  const { rows } = await db.query<{ github_inbox_days: number }>(
    'SELECT github_inbox_days FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows[0]?.github_inbox_days === 30 ? 30 : 14;
}

export async function saveInboxWindowDays(
  db: Queryable,
  workspaceId: string,
  days: GithubInboxWindowDays,
): Promise<void> {
  await db.query(
    `INSERT INTO profiles (workspace_id, github_inbox_days) VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET github_inbox_days = EXCLUDED.github_inbox_days`,
    [workspaceId, days],
  );
}

export async function markInboxSeen(
  db: Queryable,
  workspaceId: string,
  itemId: string,
  headSha: string,
): Promise<void> {
  await db.query(
    `INSERT INTO github_inbox_seen (workspace_id, item_id, head_sha) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, item_id)
     DO UPDATE SET head_sha = EXCLUDED.head_sha, seen_at = now()`,
    [workspaceId, itemId, headSha],
  );
}

export async function inboxSeenMarks(
  db: Queryable,
  workspaceId: string,
  itemIds: readonly string[],
): Promise<Map<string, SeenMark>> {
  if (itemIds.length === 0) return new Map();
  const { rows } = await db.query<{ item_id: string; head_sha: string; seen_at: Date }>(
    `SELECT item_id, head_sha, seen_at FROM github_inbox_seen
     WHERE workspace_id = $1 AND item_id = ANY($2::text[])`,
    [workspaceId, itemIds],
  );
  return new Map(rows.map((row) => [row.item_id, { headSha: row.head_sha, seenAt: row.seen_at }]));
}

interface PullAddress {
  host: string;
  owner: string;
  repo: string;
  number: number;
}

export const watchKey = (pull: PullAddress) =>
  `${pull.host}/${pull.owner}/${pull.repo}#${pull.number}`.toLowerCase();

export async function chatsWatchingPulls(
  db: Queryable,
  workspaceId: string,
  pulls: readonly PullAddress[],
): Promise<Map<string, string>> {
  if (pulls.length === 0) return new Map();
  const { rows } = await db.query<{ key: string; conversation_id: string }>(
    `SELECT DISTINCT ON (key) key, conversation_id FROM (
       SELECT lower(host || '/' || owner || '/' || repo || '#' || number) AS key,
         conversation_id, updated_at
       FROM pr_watches WHERE workspace_id = $1
     ) watched
     WHERE key = ANY($2::text[])
     ORDER BY key, updated_at DESC`,
    [workspaceId, pulls.map(watchKey)],
  );
  return new Map(rows.map((row) => [row.key, row.conversation_id]));
}

export async function knownTicketsNamed(
  db: Queryable,
  workspaceId: string,
  keys: readonly string[],
): Promise<Map<string, GithubInboxTicket>> {
  if (keys.length === 0) return new Map();
  const { rows } = await db.query<{
    source: string;
    key: string;
    title: string;
    status_name: string;
    url: string;
  }>(
    `SELECT t.source, t.key, t.title, t.status_name, t.url
     FROM tickets t
     JOIN ticket_connections c ON c.workspace_id = t.workspace_id AND c.source = t.source
     WHERE t.workspace_id = $1 AND upper(t.key) = ANY($2::text[])
     ORDER BY t.source, t.key`,
    [workspaceId, keys.map((key) => key.toUpperCase())],
  );
  const found = new Map<string, GithubInboxTicket>();
  for (const row of rows) {
    const upper = row.key.toUpperCase();
    if (found.has(upper)) continue;
    found.set(upper, {
      source: row.source,
      key: row.key,
      title: row.title,
      status: row.status_name,
      url: row.url,
    });
  }
  return found;
}

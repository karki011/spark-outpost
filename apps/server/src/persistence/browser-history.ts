import type {
  BrowserHistoryEntry,
  BrowserHistoryEvent,
  BrowserHistoryQuery,
  BrowserProfile,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

interface HistoryRow {
  profile: BrowserProfile;
  url: string;
  title: string;
  visit_count: number;
  last_visited_at: Date;
}

function toEntry(row: HistoryRow): BrowserHistoryEntry {
  return {
    profile: row.profile,
    url: row.url,
    title: row.title,
    visitCount: row.visit_count,
    lastVisitedAt: row.last_visited_at.toISOString(),
  };
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

export async function recordHistory(
  db: Queryable,
  workspaceId: string,
  event: BrowserHistoryEvent,
): Promise<void> {
  if (event.kind === 'title') {
    await db.query(
      `UPDATE browser_history SET title = $4
       WHERE workspace_id = $1 AND profile = $2 AND url = $3`,
      [workspaceId, event.profile, event.url, event.title],
    );
    return;
  }
  await db.query(
    `INSERT INTO browser_history (workspace_id, profile, url, title)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, profile, url) DO UPDATE SET
       visit_count = browser_history.visit_count + 1,
       last_visited_at = now(),
       title = CASE WHEN EXCLUDED.title = '' THEN browser_history.title ELSE EXCLUDED.title END`,
    [workspaceId, event.profile, event.url, event.title],
  );
}

export async function searchHistory(
  db: Queryable,
  workspaceId: string,
  query: BrowserHistoryQuery,
): Promise<BrowserHistoryEntry[]> {
  const text = query.q.trim();
  const { rows } = await db.query<HistoryRow>(
    `SELECT profile, url, title, visit_count, last_visited_at FROM browser_history
     WHERE workspace_id = $1 AND profile = $2
       AND ($3 = '' OR title ILIKE $4 OR url ILIKE $4)
     ORDER BY last_visited_at DESC
     LIMIT $5`,
    [workspaceId, query.profile, text, likePattern(text), query.limit],
  );
  return rows.map(toEntry);
}

export async function clearHistory(
  db: Queryable,
  workspaceId: string,
  profile: BrowserProfile | null,
  since: Date | null,
): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM browser_history
     WHERE workspace_id = $1
       AND ($2::text IS NULL OR profile = $2)
       AND ($3::timestamptz IS NULL OR last_visited_at >= $3)`,
    [workspaceId, profile, since],
  );
  return rowCount ?? 0;
}

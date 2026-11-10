import {
  PR_FOLLOW_UP_SPARK,
  RELAY_DEFAULTS,
  roundOutcomeSchema,
  type RelayPull,
  type RelayPullState,
  type RelayWatch,
  type RoundOutcome,
  type TeammateBrief,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { newId } from './ids.ts';
import { prFollowUpSettings } from './pr-settings.ts';

async function freeRelayName(db: Queryable, workspaceId: string): Promise<string> {
  const { rows } = await db.query<{ taken: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM teammates WHERE workspace_id = $1 AND lower(name) = lower($2)) AS taken',
    [workspaceId, RELAY_DEFAULTS.name],
  );
  return rows[0]?.taken ? RELAY_DEFAULTS.fallbackName : RELAY_DEFAULTS.name;
}

export async function seedRelay(db: Queryable, workspaceId: string): Promise<boolean> {
  await db.query('INSERT INTO profiles (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING', [
    workspaceId,
  ]);
  const name = await freeRelayName(db, workspaceId);
  const { rowCount } = await db.query(
    `WITH claimed AS (
       UPDATE profiles SET relay_seeded_at = now()
       WHERE workspace_id = $2 AND relay_seeded_at IS NULL RETURNING workspace_id
     )
     INSERT INTO teammates (id, workspace_id, name, role, face_shape, face_color, instructions, kind)
     SELECT $1, workspace_id, $3, $4, $5, $6, $7, $8 FROM claimed
     ON CONFLICT DO NOTHING`,
    [
      newId(),
      workspaceId,
      name,
      RELAY_DEFAULTS.role,
      RELAY_DEFAULTS.face.shape,
      RELAY_DEFAULTS.face.color,
      RELAY_DEFAULTS.instructions,
      PR_FOLLOW_UP_SPARK,
    ],
  );
  return (rowCount ?? 0) > 0;
}

export type RelayBrief = TeammateBrief & { instructionsPath: string | null };

export async function relayBrief(db: Queryable, workspaceId: string): Promise<RelayBrief | null> {
  const { rows } = await db.query<{
    name: string;
    role: string;
    instructions: string;
    instructions_path: string | null;
  }>(
    `SELECT name, role, instructions, instructions_path FROM teammates
     WHERE workspace_id = $1 AND kind = $2`,
    [workspaceId, PR_FOLLOW_UP_SPARK],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    name: row.name,
    role: row.role,
    instructions: row.instructions,
    instructionsPath: row.instructions_path,
  };
}

interface WatchedRow {
  id: string;
  conversation_id: string;
  title: string;
  owner: string;
  repo: string;
  number: number;
  url: string;
  phase: string;
  quiet: boolean;
  clean: boolean;
}

export function relayPullState(row: Pick<WatchedRow, 'phase' | 'quiet' | 'clean'>): RelayPullState {
  if (row.phase === 'fixing') return 'round';
  if (row.phase === 'confirming' || row.phase === 'needs_you') return 'needs_you';
  if (row.quiet) return 'stopped';
  if (row.clean) return 'clean';
  return 'watching';
}

export async function relayWatch(db: Queryable, workspaceId: string): Promise<RelayWatch> {
  const settings = await prFollowUpSettings(db, workspaceId);
  const { rows } = await db.query<WatchedRow>(
    `SELECT w.id, w.conversation_id, c.title, w.owner, w.repo, w.number, w.url, w.phase,
       w.quiet_head IS NOT NULL AS quiet,
       (w.clean_since IS NOT NULL AND w.head_sha IS NOT NULL AND w.clean_head_sha = w.head_sha)
         AS clean
     FROM pr_watches w JOIN conversations c ON c.id = w.conversation_id
     WHERE w.workspace_id = $1 AND w.follow_up AND w.task_id IS NOT NULL
       AND w.pr_state = 'open' AND NOT w.outside AND c.archived_at IS NULL
     ORDER BY w.updated_at DESC, w.id`,
    [workspaceId],
  );
  const pulls = rows.map((row): RelayPull => ({
    id: row.id,
    conversationId: row.conversation_id,
    chatTitle: row.title,
    repo: `${row.owner}/${row.repo}`,
    number: row.number,
    url: row.url,
    state: relayPullState(row),
  }));
  const followUp = !settings.enabled ? 'off' : settings.ask ? 'ask' : 'on';
  return { followUp, pulls };
}

export async function recordRoundOutcome(
  db: Queryable,
  watchId: string,
  outcome: RoundOutcome,
): Promise<void> {
  await db.query(
    `UPDATE pr_watches SET round_outcomes = COALESCE((
       SELECT jsonb_agg(kept ORDER BY ordinality) FROM jsonb_array_elements(round_outcomes)
         WITH ORDINALITY AS listed (kept, ordinality)
       WHERE kept->>'runId' <> $2
     ), '[]'::jsonb) || jsonb_build_array($3::jsonb)
     WHERE id = $1`,
    [watchId, outcome.runId, JSON.stringify(outcome)],
  );
}

export function roundOutcomesOf(stored: unknown): RoundOutcome[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((entry) => {
    const parsed = roundOutcomeSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

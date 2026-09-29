import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  attentionSettingsSchema,
  DEFAULT_ATTENTION_SETTINGS,
  type AttentionSettings,
  type UpdateAttentionSettings,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

interface SettingsRow {
  idle_days: number;
  due_days: number;
  review_days: number;
  brief_enabled: boolean;
  brief_interval_minutes: number;
  connect_hint_dismissed: boolean;
}

function toSettings(row: SettingsRow | undefined): AttentionSettings {
  if (!row) return DEFAULT_ATTENTION_SETTINGS;
  const parsed = attentionSettingsSchema.safeParse({
    idleDays: row.idle_days,
    dueDays: row.due_days,
    reviewDays: row.review_days,
    briefEnabled: row.brief_enabled,
    briefIntervalMinutes: row.brief_interval_minutes,
    connectHintDismissed: row.connect_hint_dismissed,
  });
  return parsed.success ? parsed.data : DEFAULT_ATTENTION_SETTINGS;
}

export async function getAttentionSettings(
  db: Queryable,
  workspaceId: string,
): Promise<AttentionSettings> {
  const { rows } = await db.query<SettingsRow>(
    'SELECT * FROM attention_settings WHERE workspace_id = $1',
    [workspaceId],
  );
  return toSettings(rows[0]);
}

export async function updateAttentionSettings(
  db: Queryable,
  workspaceId: string,
  update: UpdateAttentionSettings,
): Promise<AttentionSettings> {
  const next = { ...(await getAttentionSettings(db, workspaceId)), ...update };
  const { rows } = await db.query<SettingsRow>(
    `INSERT INTO attention_settings (workspace_id, idle_days, due_days, review_days,
       brief_enabled, brief_interval_minutes, connect_hint_dismissed)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (workspace_id) DO UPDATE SET idle_days = EXCLUDED.idle_days,
       due_days = EXCLUDED.due_days, review_days = EXCLUDED.review_days,
       brief_enabled = EXCLUDED.brief_enabled,
       brief_interval_minutes = EXCLUDED.brief_interval_minutes,
       connect_hint_dismissed = EXCLUDED.connect_hint_dismissed
     RETURNING *`,
    [
      workspaceId,
      next.idleDays,
      next.dueDays,
      next.reviewDays,
      next.briefEnabled,
      next.briefIntervalMinutes,
      next.connectHintDismissed,
    ],
  );
  return toSettings(rows[0]);
}

export const flaggedItemSchema = z.object({
  itemId: z.string(),
  key: z.string(),
  title: z.string(),
  source: z.string(),
  status: z.string(),
  priority: z.string().nullable(),
  dueDate: z.string().nullable(),
  project: z.string().nullable(),
  pullRequest: z.object({ repo: z.string(), number: z.number(), state: z.string() }).nullable(),
  flags: z.array(z.object({ rule: z.string(), text: z.string(), days: z.number().nullable() })),
});
export type FlaggedItem = z.infer<typeof flaggedItemSchema>;

export interface AttentionSnapshot {
  items: FlaggedItem[];
  hash: string;
}

export function flaggedHash(items: readonly FlaggedItem[]): string {
  const identity = items.map((item) => [item.itemId, item.flags.map((flag) => flag.text)]);
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 32);
}

export async function saveAttentionSnapshot(
  db: Queryable,
  workspaceId: string,
  items: readonly FlaggedItem[],
): Promise<void> {
  await db.query(
    `INSERT INTO attention_snapshots (workspace_id, items, hash) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id) DO UPDATE SET items = EXCLUDED.items, hash = EXCLUDED.hash,
       computed_at = now()`,
    [workspaceId, JSON.stringify(items), flaggedHash(items)],
  );
}

export async function attentionSnapshot(
  db: Queryable,
  workspaceId: string,
): Promise<AttentionSnapshot> {
  const { rows } = await db.query<{ items: unknown; hash: string }>(
    'SELECT items, hash FROM attention_snapshots WHERE workspace_id = $1',
    [workspaceId],
  );
  const items = z.array(flaggedItemSchema).safeParse(rows[0]?.items ?? []);
  const list = items.success ? items.data : [];
  return { items: list, hash: flaggedHash(list) };
}

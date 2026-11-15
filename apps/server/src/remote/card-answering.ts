import {
  REMOTE_CARD_ANSWERING_DEFAULT,
  remoteCardAnsweringSchema,
  remoteKindOn,
  type RemoteCardAnswering,
  type RemoteCardKind,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';

type AnsweringColumns = Record<string, unknown>;

export function cardAnsweringOf(row: AnsweringColumns | undefined): RemoteCardAnswering {
  if (!row) return { ...REMOTE_CARD_ANSWERING_DEFAULT };
  const parsed = remoteCardAnsweringSchema.safeParse({
    from: row.card_answer_from,
    macOnly: row.card_mac_only,
  });
  return parsed.success ? parsed.data : { ...REMOTE_CARD_ANSWERING_DEFAULT };
}

export async function saveCardAnswering(
  db: Queryable,
  workspaceId: string,
  change: {
    from?: RemoteCardAnswering['from'] | undefined;
    macOnly?: RemoteCardKind[] | undefined;
  },
): Promise<RemoteCardAnswering> {
  const macOnly = change.macOnly ? [...new Set(change.macOnly)] : null;
  const { rows } = await db.query<AnsweringColumns>(
    `INSERT INTO remote_access_settings (workspace_id, card_answer_from, card_mac_only)
     VALUES ($1, COALESCE($2, 'mac'), COALESCE($3::text[], ARRAY['rules', 'macControl']))
     ON CONFLICT (workspace_id) DO UPDATE SET
       card_answer_from = COALESCE($2, remote_access_settings.card_answer_from),
       card_mac_only = COALESCE($3::text[], remote_access_settings.card_mac_only),
       updated_at = now()
     RETURNING card_answer_from, card_mac_only`,
    [workspaceId, change.from ?? null, macOnly],
  );
  return cardAnsweringOf(rows[0]);
}

export async function remoteKindAllowed(
  db: Queryable,
  conversationId: string,
  kind: RemoteCardKind,
): Promise<boolean> {
  const { rows } = await db.query<AnsweringColumns>(
    `SELECT s.card_answer_from, s.card_mac_only FROM conversations c
     JOIN remote_access_settings s ON s.workspace_id = c.workspace_id WHERE c.id = $1`,
    [conversationId],
  );
  return remoteKindOn(cardAnsweringOf(rows[0]), kind);
}

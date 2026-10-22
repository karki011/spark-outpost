import type { Queryable } from '../persistence/db.ts';
import { chatFolderIds, removeChatFolder } from './folders.ts';

export async function pruneChatFolders(db: Queryable, base: string): Promise<number> {
  const ids = await chatFolderIds(base);
  if (ids.length === 0) return 0;
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM conversations WHERE id = ANY($1::uuid[])',
    [ids],
  );
  const kept = new Set(rows.map((row) => row.id));
  const gone = ids.filter((id) => !kept.has(id));
  for (const id of gone) await removeChatFolder(base, id);
  return gone.length;
}

import type { Attachment, BrowserShot } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { newId } from './ids.ts';

export interface NewBrowserShot {
  runId: string;
  attachment: Attachment;
  page: string;
  title: string;
  width: number;
  height: number;
  sha256: string;
}

export async function insertBrowserShot(db: Queryable, shot: NewBrowserShot): Promise<string> {
  const id = newId();
  await db.query(
    `INSERT INTO browser_screenshots
       (id, run_id, conversation_id, attachment_id, page, title, width, height, sha256)
     SELECT $1, r.id, r.conversation_id, $3, $4, $5, $6, $7, $8 FROM runs r WHERE r.id = $2`,
    [
      id,
      shot.runId,
      shot.attachment.id,
      shot.page.slice(0, 4096),
      shot.title.slice(0, 300),
      shot.width,
      shot.height,
      shot.sha256,
    ],
  );
  return id;
}

interface ShotRow {
  id: string;
  run_id: string;
  turn_run_id: string;
  page: string;
  title: string;
  width: number;
  height: number;
  created_at: Date;
  attachment_id: string;
  name: string;
  media_type: string;
  size: number;
}

export async function listBrowserShots(
  db: Queryable,
  conversationId: string,
): Promise<BrowserShot[]> {
  const { rows } = await db.query<ShotRow>(
    `SELECT s.id, s.run_id, COALESCE(r.parent_run_id, s.run_id) AS turn_run_id, s.page, s.title,
            s.width, s.height, s.created_at, a.id AS attachment_id, a.name, a.media_type, a.size
     FROM browser_screenshots s
     JOIN runs r ON r.id = s.run_id
     JOIN attachments a ON a.id = s.attachment_id
     WHERE s.conversation_id = $1 ORDER BY s.created_at, s.id`,
    [conversationId],
  );
  return rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    turnRunId: row.turn_run_id,
    attachment: {
      id: row.attachment_id,
      name: row.name,
      mediaType: row.media_type,
      size: row.size,
      kind: 'image' as const,
    },
    page: row.page,
    title: row.title,
    width: row.width,
    height: row.height,
    createdAt: row.created_at.toISOString(),
  }));
}

import type { Attachment, AttachmentKind } from '@spark-outpost/contracts';
import { AttachmentError, classifyAttachment } from './attachment-content.ts';
import type { Queryable } from './db.ts';
import { newId } from './ids.ts';
import { validateQueuedAttachments } from './queued-attachments.ts';

interface AttachmentRow {
  id: string;
  message_id: string | null;
  name: string;
  media_type: string;
  kind: AttachmentKind;
  size: number;
}

export interface AttachmentFile extends Attachment {
  data: Buffer;
}

const COLUMNS = 'id, message_id, name, media_type, kind, size';

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    name: row.name,
    mediaType: row.media_type,
    size: row.size,
    kind: row.kind,
  };
}

export async function saveAttachment(
  db: Queryable,
  workspaceId: string,
  upload: { name: string; mediaType: string; data: Buffer; sourcePath?: string },
): Promise<Attachment> {
  const classified = classifyAttachment(upload.name, upload.mediaType, upload.data);
  const { rows } = await db.query<AttachmentRow>(
    `INSERT INTO attachments (id, workspace_id, name, media_type, kind, size, data, source_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
    [
      newId(),
      workspaceId,
      classified.name,
      classified.mediaType,
      classified.kind,
      upload.data.length,
      upload.data,
      upload.sourcePath ?? null,
    ],
  );
  return toAttachment(rows[0]!);
}

export async function getAttachmentContent(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<AttachmentFile | null> {
  const { rows } = await db.query<AttachmentRow & { data: Buffer }>(
    `SELECT ${COLUMNS}, data FROM attachments WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId],
  );
  const row = rows[0];
  return row ? { ...toAttachment(row), data: row.data } : null;
}

function groupByMessage<T>(
  rows: (AttachmentRow & T)[],
  map: (row: AttachmentRow & T) => Attachment & T,
) {
  const grouped = new Map<string, (Attachment & T)[]>();
  for (const row of rows) {
    if (!row.message_id) continue;
    const list = grouped.get(row.message_id) ?? [];
    list.push(map(row));
    grouped.set(row.message_id, list);
  }
  return grouped;
}

export async function attachmentsForMessages(
  db: Queryable,
  messageIds: readonly string[],
): Promise<Map<string, Attachment[]>> {
  if (messageIds.length === 0) return new Map();
  const { rows } = await db.query<AttachmentRow>(
    `SELECT ${COLUMNS} FROM attachments WHERE message_id = ANY($1::uuid[])
     ORDER BY created_at, id`,
    [messageIds],
  );
  return groupByMessage(rows, toAttachment);
}

export async function attachmentFilesForMessages(
  db: Queryable,
  messageIds: readonly string[],
): Promise<Map<string, AttachmentFile[]>> {
  if (messageIds.length === 0) return new Map();
  const { rows } = await db.query<AttachmentRow & { data: Buffer }>(
    `SELECT ${COLUMNS}, data FROM attachments WHERE message_id = ANY($1::uuid[])
     ORDER BY created_at, id`,
    [messageIds],
  );
  return groupByMessage(rows, (row) => ({ ...toAttachment(row), data: row.data }));
}

export async function linkAttachments(
  db: Queryable,
  conversationId: string,
  messageId: string,
  attachmentIds: readonly string[],
): Promise<Attachment[]> {
  const ids = [...new Set(attachmentIds)];
  if (ids.length === 0) return [];
  await validateQueuedAttachments(db, conversationId, messageId, ids);
  const { rows } = await db.query<{ id: string }>(
    `UPDATE attachments SET message_id = $1
     WHERE id = ANY($2::uuid[]) AND message_id IS NULL
       AND workspace_id = (SELECT workspace_id FROM conversations WHERE id = $3)
     RETURNING id`,
    [messageId, ids, conversationId],
  );
  if (rows.length !== ids.length) {
    throw new AttachmentError(
      'An attachment is missing or already sent. Remove it and attach the file again.',
    );
  }
  return (await attachmentsForMessages(db, [messageId])).get(messageId) ?? [];
}

export async function pruneUnlinkedAttachments(db: Queryable, workspaceId: string): Promise<void> {
  await db.query(
    `DELETE FROM attachments WHERE workspace_id = $1 AND message_id IS NULL
       AND created_at < now() - interval '1 day'
       AND NOT EXISTS (SELECT 1 FROM browser_screenshots s WHERE s.attachment_id = attachments.id)
       AND NOT EXISTS (
         SELECT 1 FROM outpost_posts p WHERE attachments.id = ANY(p.attachment_ids)
       )
       AND NOT EXISTS (
         SELECT 1 FROM member_messages m WHERE attachments.id = ANY(m.attachment_ids)
       )
       AND NOT EXISTS (
         SELECT 1 FROM chat_queue q WHERE attachments.id = ANY(q.attachment_ids)
       )
       AND NOT EXISTS (
         SELECT 1 FROM meeting_attachments ma WHERE ma.attachment_id = attachments.id
       )`,
    [workspaceId],
  );
}

export async function queuedAttachmentFiles(
  db: Queryable,
  conversationId: string,
  ids: readonly string[],
) {
  const { rows } = await db.query<{ workspace_id: string }>(
    'SELECT workspace_id FROM conversations WHERE id = $1',
    [conversationId],
  );
  const workspaceId = rows[0]?.workspace_id;
  if (!workspaceId) throw new AttachmentError('The chat is no longer available.');
  return Promise.all(
    ids.map(async (id) => {
      const file = await getAttachmentContent(db, workspaceId, id);
      if (!file) throw new AttachmentError('An attached file is no longer available.');
      return file;
    }),
  );
}

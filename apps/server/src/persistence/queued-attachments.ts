import type { AnnotationRequest } from '@spark-outpost/contracts';
import { AttachmentError } from './attachment-content.ts';
import { AnnotationError } from './annotations.ts';
import { getAttachmentContent } from './attachments.ts';
import type { Queryable } from './db.ts';

export async function validateQueuedAttachments(
  db: Queryable,
  conversationId: string,
  ids: readonly string[] = [],
  annotations: readonly AnnotationRequest[] = [],
): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length) {
    const { rowCount } = await db.query(
      `SELECT 1 FROM attachments WHERE id = ANY($1::uuid[]) AND message_id IS NULL
       AND workspace_id = (SELECT workspace_id FROM conversations WHERE id = $2)`,
      [unique, conversationId],
    );
    if (rowCount !== unique.length)
      throw new AttachmentError(
        'An attachment is missing or already sent. Remove it and attach the file again.',
      );
  }
  if (annotations.length) {
    const sourceIds = [...new Set(annotations.map((annotation) => annotation.sourceMessageId))];
    const { rowCount } = await db.query(
      'SELECT 1 FROM messages WHERE id = ANY($1::uuid[]) AND conversation_id = $2',
      [sourceIds, conversationId],
    );
    if (rowCount !== sourceIds.length)
      throw new AnnotationError(
        'A quoted message is no longer in this chat. Remove it and resend.',
      );
  }
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

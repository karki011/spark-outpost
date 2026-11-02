import type { AnnotationRequest } from '@spark-outpost/contracts';
import { AttachmentError } from './attachment-content.ts';
import { AnnotationError } from './annotations.ts';
import type { Queryable } from './db.ts';

export async function validateQueuedAttachments(
  db: Queryable,
  conversationId: string,
  messageId: string,
  ids: readonly string[] = [],
  annotations: readonly AnnotationRequest[] = [],
): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length) {
    const { rowCount } = await db.query(
      `SELECT 1 FROM attachments WHERE id = ANY($1::uuid[]) AND message_id IS NULL
       AND workspace_id = (SELECT workspace_id FROM conversations WHERE id = $2)
       ORDER BY id FOR UPDATE`,
      [unique, conversationId],
    );
    if (rowCount !== unique.length)
      throw new AttachmentError(
        'An attachment is missing or already sent. Remove it and attach the file again.',
      );
  }
  if (unique.length) {
    const reserved = await db.query(
      `SELECT 1 FROM chat_queue WHERE attachment_ids && $1::uuid[]
         AND NOT (id = $2 AND conversation_id = $3)
       UNION ALL
       SELECT 1 FROM member_messages WHERE attachment_ids && $1::uuid[]
         AND NOT (id = $2 AND conversation_id = $3)
       UNION ALL
       SELECT 1 FROM outpost_posts WHERE attachment_ids && $1::uuid[]
         AND NOT (id = $2 AND to_conversation_id IS NOT DISTINCT FROM $3::uuid)
       LIMIT 1`,
      [unique, messageId, conversationId],
    );
    if (reserved.rowCount)
      throw new AttachmentError(
        'An attachment is already in another pending message. Attach the file again.',
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

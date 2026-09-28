import type {
  AnnotationKind,
  AnnotationRequest,
  MessageAnnotation,
  TextAnchor,
} from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

export class AnnotationError extends Error {}

interface AnnotationRow {
  id: string;
  conversation_id: string;
  source_message_id: string;
  message_id: string;
  kind: AnnotationKind;
  quote: string;
  note: string;
  anchor: TextAnchor;
  created_at: Date;
}

function toAnnotation(row: AnnotationRow): MessageAnnotation {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sourceMessageId: row.source_message_id,
    messageId: row.message_id,
    kind: row.kind,
    quote: row.quote,
    note: row.note,
    anchor: row.anchor,
    createdAt: row.created_at.toISOString(),
  };
}

export async function insertAnnotations(
  db: Queryable,
  conversationId: string,
  messageId: string,
  annotations: readonly AnnotationRequest[],
): Promise<void> {
  if (annotations.length === 0) return;
  const records = annotations.map((annotation) => ({
    id: annotation.id,
    source_message_id: annotation.sourceMessageId,
    kind: annotation.kind,
    quote: annotation.quote,
    note: annotation.note,
    anchor: annotation.anchor,
  }));
  const inserted = await db.query(
    `INSERT INTO message_annotations
       (id, conversation_id, source_message_id, message_id, kind, quote, note, anchor)
     SELECT a.id, $1, a.source_message_id, $2, a.kind, a.quote, a.note, a.anchor
     FROM jsonb_to_recordset($3::jsonb)
       AS a(id uuid, source_message_id uuid, kind text, quote text, note text, anchor jsonb)
     JOIN messages m
       ON m.id = a.source_message_id AND m.conversation_id = $1 AND m.id <> $2
     ON CONFLICT (id) DO NOTHING`,
    [conversationId, messageId, JSON.stringify(records)],
  );
  if (inserted.rowCount !== annotations.length) {
    throw new AnnotationError('A quoted message is no longer in this chat. Remove it and resend.');
  }
}

export async function listAnnotations(
  db: Queryable,
  conversationId: string,
): Promise<MessageAnnotation[]> {
  const { rows } = await db.query<AnnotationRow>(
    `SELECT id, conversation_id, source_message_id, message_id, kind, quote, note, anchor,
       created_at
     FROM message_annotations WHERE conversation_id = $1 ORDER BY created_at, id`,
    [conversationId],
  );
  return rows.map(toAnnotation);
}

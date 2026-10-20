import type { AssistantEventKind, AssistantTopic } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

const TOPIC_KINDS: Partial<Record<AssistantEventKind, AssistantTopic['kind']>> = {
  topic_started: 'topic',
  history_cleared: 'cleared',
};

interface TopicRow {
  id: string;
  kind: AssistantEventKind;
  at: Date;
}

function toTopic(row: TopicRow): AssistantTopic {
  return { id: row.id, kind: TOPIC_KINDS[row.kind]!, at: row.at.toISOString() };
}

export interface TopicRange {
  from: Date | null;
  until: Date | null;
}

export async function listAssistantTopics(
  db: Queryable,
  workspaceId: string,
  range: TopicRange,
): Promise<AssistantTopic[]> {
  const { rows } = await db.query<TopicRow>(
    `SELECT id, kind, at FROM assistant_events
     WHERE workspace_id = $1 AND kind = ANY($2::text[])
       AND ($3::timestamptz IS NULL OR at >= $3) AND ($4::timestamptz IS NULL OR at < $4)
     ORDER BY at, id`,
    [workspaceId, Object.keys(TOPIC_KINDS), range.from, range.until],
  );
  return rows.map(toTopic);
}

export async function conversationTopics(
  db: Queryable,
  conversationId: string,
): Promise<AssistantTopic[]> {
  const { rows } = await db.query<TopicRow>(
    `SELECT e.id, e.kind, e.at FROM assistant_events e
     JOIN profiles p ON p.workspace_id = e.workspace_id
     WHERE p.assistant_conversation_id = $1 AND e.kind = ANY($2::text[])
     ORDER BY e.at, e.id`,
    [conversationId, Object.keys(TOPIC_KINDS)],
  );
  return rows.map(toTopic);
}

import type { AssistantEventKind, AssistantTopic } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';

type AssistantTopicKind = Exclude<AssistantTopic['kind'], 'spark_settings'>;

const TOPIC_KINDS: Partial<Record<AssistantEventKind, AssistantTopicKind>> = {
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

async function sparkSettingsNotes(
  db: Queryable,
  conversationId: string,
): Promise<AssistantTopic[]> {
  const { rows } = await db.query<{ id: string; name: string; at: Date }>(
    `SELECT id, name, at FROM chat_notes
     WHERE conversation_id = $1 AND kind = 'spark_settings' ORDER BY at, id`,
    [conversationId],
  );
  return rows.map((row) => ({
    id: row.id,
    kind: 'spark_settings',
    at: row.at.toISOString(),
    name: row.name,
  }));
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
  const notes = await sparkSettingsNotes(db, conversationId);
  return [...rows.map(toTopic), ...notes].sort((a, b) => a.at.localeCompare(b.at));
}

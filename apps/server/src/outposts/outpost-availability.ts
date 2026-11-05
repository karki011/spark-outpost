import type { Queryable } from '../persistence/db.ts';

export interface OutpostNeeds {
  outpost: boolean;
  outpost_draft: boolean;
  outpost_start: boolean;
}

export interface OutpostSession {
  conversationId: string | null;
  runId: string | null;
}

const NEITHER: OutpostNeeds = { outpost: false, outpost_draft: false, outpost_start: false };

interface SessionRow {
  member: boolean;
  project: boolean;
  story_task: boolean;
  from_request: boolean;
}

export async function outpostNeeds(db: Queryable, session: OutpostSession): Promise<OutpostNeeds> {
  if (session.conversationId === null || session.runId === null) return NEITHER;
  const { rows } = await db.query<SessionRow>(
    `SELECT
       EXISTS (SELECT 1 FROM outpost_members m WHERE m.conversation_id = c.id) AS member,
       EXISTS (SELECT 1 FROM conversation_projects p WHERE p.conversation_id = c.id) AS project,
       EXISTS (SELECT 1 FROM outpost_story_tasks t WHERE t.conversation_id = c.id) AS story_task,
       EXISTS (SELECT 1 FROM outpost_posts post
               WHERE r.source = 'outpost' AND post.id = r.user_message_id
                 AND NOT post.from_user AND NOT post.user_started) AS from_request
     FROM conversations c
     JOIN runs r ON r.conversation_id = c.id
     WHERE c.id = $1 AND r.id = $2 AND r.parent_run_id IS NULL
       AND c.session_type <> 'terminal'`,
    [session.conversationId, session.runId],
  );
  const row = rows[0];
  if (!row) return NEITHER;
  const proposes = row.member || row.project;
  return {
    outpost: row.member,
    outpost_draft: proposes,
    outpost_start: proposes && !row.story_task && !row.from_request,
  };
}

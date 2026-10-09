import type { StoryPullState } from '@spark-outpost/contracts';
import type { StoredStoryTask, StoryStore, StoryTaskRow } from '../outposts/ports.ts';
import type { Queryable } from './db.ts';
import { postsById } from './outpost-posts.ts';

interface TaskRow {
  conversation_id: string;
  outpost_id: string;
  draft_id: string | null;
  lead_conversation_id: string | null;
  title: string;
  position: number;
  depends_on_conversation_id: string | null;
  opening_post_id: string | null;
  created_at: Date;
}

interface StoryRow extends TaskRow {
  handle: string;
  story_title: string | null;
  lead_handle: string | null;
  project_id: string | null;
  repo_root: string | null;
  branch: string | null;
  base_branch: string | null;
  owns_branch: boolean;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: StoryPullState | null;
  pr_draft: boolean | null;
  pr_base: string | null;
  pr_head_sha: string | null;
}

const TASK_COLUMNS = `conversation_id, outpost_id, draft_id, lead_conversation_id, title, position,
  depends_on_conversation_id, opening_post_id, created_at`;

const STORY_QUERY = `
  SELECT t.*,
    COALESCE(m.handle, opening.to_handle, '') AS handle,
    d.title AS story_title,
    lead.handle AS lead_handle,
    place.project_id,
    COALESCE(w.repo_root, place.root_path) AS repo_root,
    w.branch, w.base_branch, COALESCE(w.owns_branch, false) AS owns_branch,
    pr.number AS pr_number, pr.url AS pr_url, pr.pr_state, pr.draft AS pr_draft,
    pr.base AS pr_base, pr.head_sha AS pr_head_sha
  FROM outpost_story_tasks t
  LEFT JOIN outpost_members m
    ON m.outpost_id = t.outpost_id AND m.conversation_id = t.conversation_id
  LEFT JOIN outpost_members lead
    ON lead.outpost_id = t.outpost_id AND lead.conversation_id = t.lead_conversation_id
  LEFT JOIN outpost_posts opening ON opening.id = t.opening_post_id
  LEFT JOIN outpost_drafts d ON d.id = t.draft_id
  LEFT JOIN LATERAL (
    SELECT cp.project_id, p.root_path
    FROM conversation_projects cp JOIN projects p ON p.id = cp.project_id
    WHERE cp.conversation_id = t.conversation_id
    ORDER BY cp.position, cp.created_at LIMIT 1
  ) place ON true
  LEFT JOIN LATERAL (
    SELECT tree.repo_root, tree.branch, tree.base_branch, tree.owns_branch
    FROM chat_worktrees tree
    WHERE tree.conversation_id = t.conversation_id AND tree.project_id = place.project_id
      AND tree.removed_at IS NULL
    ORDER BY tree.created_at LIMIT 1
  ) w ON true
  LEFT JOIN LATERAL (
    SELECT pull.number, pull.url, pull.pr_state, pull.draft, pull.base, pull.head_sha
    FROM pr_watches pull
    WHERE pull.conversation_id = t.conversation_id
    ORDER BY (pull.branch = w.branch) DESC NULLS LAST, pull.created_at DESC LIMIT 1
  ) pr ON true`;

function toTask(row: TaskRow): StoredStoryTask {
  return {
    conversationId: row.conversation_id,
    outpostId: row.outpost_id,
    draftId: row.draft_id,
    leadConversationId: row.lead_conversation_id,
    title: row.title,
    position: row.position,
    dependsOnConversationId: row.depends_on_conversation_id,
    openingPostId: row.opening_post_id,
    createdAt: row.created_at.toISOString(),
  };
}

function toPull(row: StoryRow): StoryTaskRow['pull'] {
  if (row.pr_number === null || row.pr_url === null || row.pr_state === null) return null;
  return {
    number: row.pr_number,
    url: row.pr_url,
    state: row.pr_state,
    draft: row.pr_draft === true,
    base: row.pr_base,
    headSha: row.pr_head_sha,
  };
}

async function withOpenings(db: Queryable, rows: StoryRow[]): Promise<StoryTaskRow[]> {
  const openings = await postsById(
    db,
    rows.flatMap((row) => row.opening_post_id ?? []),
  );
  return rows.map((row) => ({
    task: toTask(row),
    handle: row.handle,
    storyTitle: row.story_title,
    leadHandle: row.lead_handle,
    projectId: row.project_id,
    repoRoot: row.repo_root,
    branch: row.branch,
    baseBranch: row.base_branch,
    ownsBranch: row.owns_branch,
    pull: toPull(row),
    opening: (row.opening_post_id && openings.get(row.opening_post_id)) || null,
  }));
}

export const insertTasks: StoryStore['insertTasks'] = async (db, tasks) => {
  for (const task of tasks) {
    await db.query(
      `INSERT INTO outpost_story_tasks AS t (conversation_id, outpost_id, draft_id,
         lead_conversation_id, title, position, depends_on_conversation_id, opening_post_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (conversation_id) DO UPDATE
         SET opening_post_id = COALESCE(t.opening_post_id, EXCLUDED.opening_post_id)
         WHERE t.outpost_id = EXCLUDED.outpost_id
           AND t.draft_id IS NOT DISTINCT FROM EXCLUDED.draft_id`,
      [
        task.conversationId,
        task.outpostId,
        task.draftId,
        task.leadConversationId,
        task.title,
        task.position,
        task.dependsOnConversationId,
        task.openingPostId,
      ],
    );
  }
  if (tasks.length === 0) return [];
  const { rows } = await db.query<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM outpost_story_tasks
     WHERE conversation_id = ANY($1::uuid[]) ORDER BY created_at, position, conversation_id`,
    [tasks.map((task) => task.conversationId)],
  );
  return rows.map(toTask);
};

export const storiesOf: StoryStore['storiesOf'] = async (db, outpostId) => {
  const { rows } = await db.query<StoryRow>(
    `${STORY_QUERY} WHERE t.outpost_id = $1 ORDER BY t.created_at, t.position, t.conversation_id`,
    [outpostId],
  );
  return withOpenings(db, rows);
};

export const storyTaskOf: StoryStore['storyTaskOf'] = async (db, conversationId) => {
  const { rows } = await db.query<StoryRow>(`${STORY_QUERY} WHERE t.conversation_id = $1`, [
    conversationId,
  ]);
  return (await withOpenings(db, rows))[0] ?? null;
};

export const removeTask: StoryStore['removeTask'] = async (db, conversationId) => {
  await db.query(
    `UPDATE outpost_story_tasks SET depends_on_conversation_id = NULL
     WHERE depends_on_conversation_id = $1`,
    [conversationId],
  );
  const { rowCount } = await db.query(
    'DELETE FROM outpost_story_tasks WHERE conversation_id = $1',
    [conversationId],
  );
  return rowCount === 1;
};

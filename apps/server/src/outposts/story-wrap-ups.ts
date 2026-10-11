import { requestState, storyOrder, type OutpostAnswer } from '@spark-outpost/contracts';
import { withTransaction, type Db, type Queryable } from '../persistence/db.ts';
import { markReported } from '../persistence/outpost-drafts.ts';
import { requestAnswer } from '../persistence/outpost-answers.ts';
import { insertPosts } from '../persistence/outpost-posts.ts';
import { storiesOf } from '../persistence/outpost-stories.ts';
import type { NewPost, StoryTaskRow } from './ports.ts';
import { storySettled, wrapUpBody, type WrapUpFacts, type WrapUpTask } from './story-wrap-up.ts';

interface OpenStory {
  workspaceId: string;
  draftId: string;
  title: string;
  outpostId: string;
  leadConversationId: string;
  leadHandle: string;
}

interface OpenStoryRow {
  workspace_id: string;
  id: string;
  title: string;
  outpost_id: string;
  lead_conversation_id: string;
  lead_handle: string;
}

async function unreportedStories(db: Queryable): Promise<OpenStory[]> {
  const { rows } = await db.query<OpenStoryRow>(
    `SELECT o.workspace_id, d.id, d.title, d.outpost_id,
       lead.conversation_id AS lead_conversation_id,
       lead.handle AS lead_handle
     FROM outpost_drafts d
     JOIN outposts o ON o.id = d.outpost_id AND o.paused_at IS NULL
     JOIN outpost_members lead
       ON lead.outpost_id = d.outpost_id AND lead.conversation_id = d.conversation_id
     WHERE d.started_at IS NOT NULL AND d.reported_at IS NULL
     ORDER BY d.started_at, d.id`,
  );
  return rows.map((row) => ({
    workspaceId: row.workspace_id,
    draftId: row.id,
    title: row.title,
    outpostId: row.outpost_id,
    leadConversationId: row.lead_conversation_id,
    leadHandle: row.lead_handle,
  }));
}

function inOrder(rows: readonly StoryTaskRow[]): StoryTaskRow[] {
  const byChat = new Map(rows.map((row) => [row.task.conversationId, row]));
  return storyOrder(
    rows.map((row) => ({
      conversationId: row.task.conversationId,
      dependsOn: row.task.dependsOnConversationId,
      position: row.task.position,
    })),
  ).flatMap((item) => byChat.get(item.conversationId) ?? []);
}

function factsOf(answer: OutpostAnswer | null): WrapUpFacts | null {
  if (!answer?.publish) return null;
  return {
    files: answer.changes.length,
    branch: answer.branch,
    committed: answer.publish.committed,
    pushed: answer.publish.pushed,
    notPublished: answer.publish.reason,
  };
}

async function toWrapUpTasks(
  db: Queryable,
  workspaceId: string,
  rows: readonly StoryTaskRow[],
): Promise<WrapUpTask[]> {
  const handles = new Map(rows.map((row) => [row.task.conversationId, row.handle]));
  const tasks: WrapUpTask[] = [];
  for (const row of inOrder(rows)) {
    const derived = row.opening?.facts ? requestState(row.opening.facts) : null;
    const parentId = row.task.dependsOnConversationId;
    const answer =
      row.opening && derived?.state === 'answered'
        ? await requestAnswer(db, workspaceId, row.opening).catch(() => null)
        : null;
    tasks.push({
      handle: row.handle,
      title: row.task.title,
      state: derived?.state ?? null,
      reason: derived?.reason ?? null,
      afterHandle: parentId === null ? null : (handles.get(parentId) ?? null),
      pullRequest: row.pull?.url ?? answer?.pullRequests[0] ?? null,
      facts: factsOf(answer),
    });
  }
  return tasks;
}

function settled(rows: readonly StoryTaskRow[]): boolean {
  return storySettled(
    rows.map((row) => ({
      state: row.opening?.facts ? requestState(row.opening.facts).state : null,
    })),
  );
}

function wrapUpPost(story: OpenStory, tasks: readonly WrapUpTask[]): NewPost {
  return {
    id: story.draftId,
    outpostId: story.outpostId,
    kind: 'request',
    body: wrapUpBody(story.title, tasks),
    fromUser: false,
    toHandle: story.leadHandle,
    toConversationId: story.leadConversationId,
  };
}

function claimAndWrite(db: Db, post: NewPost): Promise<boolean> {
  return withTransaction(db, async (client) => {
    if (!(await markReported(client, post.id))) return false;
    await insertPosts(client, [post]);
    return true;
  });
}

export async function queueWrapUps(db: Db): Promise<number> {
  const rowsByOutpost = new Map<string, StoryTaskRow[]>();
  let written = 0;
  for (const story of await unreportedStories(db)) {
    const rows = rowsByOutpost.get(story.outpostId) ?? (await storiesOf(db, story.outpostId));
    rowsByOutpost.set(story.outpostId, rows);
    const own = rows.filter((row) => row.task.draftId === story.draftId);
    if (!settled(own)) continue;
    const tasks = await toWrapUpTasks(db, story.workspaceId, own);
    if (await claimAndWrite(db, wrapUpPost(story, tasks))) written += 1;
  }
  return written;
}

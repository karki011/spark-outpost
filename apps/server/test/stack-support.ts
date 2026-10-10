import { randomUUID } from 'node:crypto';
import { createConversation } from '../src/persistence/conversations.ts';
import { insertTasks } from '../src/persistence/outpost-stories.ts';
import { createOutpost } from '../src/persistence/outposts.ts';
import { createProject } from '../src/projects/projects.ts';
import type { TestDb } from './support.ts';

export interface StackedPair {
  projectId: string;
  outpostId: string;
  api: string;
  web: string;
}

export async function projectChat(t: TestDb, projectId: string): Promise<string> {
  const id = randomUUID();
  await createConversation(t.db, t.workspaceId, id, { projectIds: [projectId] });
  return id;
}

export async function dependOn(t: TestDb, api: string, web: string): Promise<string> {
  const outpostId = randomUUID();
  await createOutpost(t.db, {
    id: outpostId,
    workspaceId: t.workspaceId,
    name: 'Orders launch',
    members: [
      { conversationId: api, handle: 'api' },
      { conversationId: web, handle: 'web' },
    ],
  });
  const task = { outpostId, draftId: null, leadConversationId: null, openingPostId: null };
  await insertTasks(t.db, [
    {
      ...task,
      conversationId: api,
      title: 'Orders endpoint',
      position: 0,
      dependsOnConversationId: null,
    },
    {
      ...task,
      conversationId: web,
      title: 'Orders page',
      position: 1,
      dependsOnConversationId: api,
    },
  ]);
  return outpostId;
}

export async function stackedPair(t: TestDb, root: string, webRoot = root): Promise<StackedPair> {
  const projectId = (await createProject(t.db, t.workspaceId, root)).project.id;
  const webProject = (await createProject(t.db, t.workspaceId, webRoot)).project.id;
  const api = await projectChat(t, projectId);
  const web = await projectChat(t, webProject);
  return { projectId, outpostId: await dependOn(t, api, web), api, web };
}

export async function ownedWorktree(
  t: TestDb,
  place: { conversationId: string; projectId: string; root: string; path?: string },
  branch: string,
  baseBranch: string,
): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `INSERT INTO chat_worktrees (id, conversation_id, project_id, repo_root, path, branch,
       base_branch, base_commit, owns_branch)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'abc123', true)`,
    [
      id,
      place.conversationId,
      place.projectId,
      place.root,
      place.path ?? `${place.root}/.spark/${id}`,
      branch,
      baseBranch,
    ],
  );
  return id;
}

export async function watchedPull(
  t: TestDb,
  conversationId: string,
  branch: string,
  state: 'open' | 'merged' | 'closed',
): Promise<void> {
  await t.db.query(
    `INSERT INTO pr_watches (id, workspace_id, conversation_id, host, owner, repo, number, url,
       branch, base, head_sha, pr_state)
     VALUES ($1, $2, $3, 'github.com', 'acme', 'widgets', 7,
       'https://github.com/acme/widgets/pull/7', $4, 'main', 'sha1', $5)`,
    [randomUUID(), t.workspaceId, conversationId, branch, state],
  );
}

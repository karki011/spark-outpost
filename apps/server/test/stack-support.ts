import { randomUUID } from 'node:crypto';
import { createConversation } from '../src/persistence/conversations.ts';
import { withTransaction } from '../src/persistence/db.ts';
import { insertSubChat } from '../src/persistence/sub-chats.ts';
import { createProject } from '../src/projects/projects.ts';
import { emptyChat, STARTED_WITH } from './sub-chat-fixtures.ts';
import type { TestDb } from './support.ts';

export const STACK_PARENT_TITLE = 'Orders endpoint';

export interface StackedPair {
  projectId: string;
  api: string;
  web: string;
}

export async function projectChat(t: TestDb, projectId: string): Promise<string> {
  const id = randomUUID();
  await createConversation(t.db, t.workspaceId, id, { projectIds: [projectId] });
  return id;
}

async function subChatOf(t: TestDb, parent: string, chat: string, stackedOn: string | null) {
  await withTransaction(t.db, (client) =>
    insertSubChat(client, {
      conversationId: chat,
      parentConversationId: parent,
      task: 'Build it.',
      stackedOn,
      startsAfter: [],
      startedWith: STARTED_WITH,
      approvalId: null,
    }),
  );
}

export async function dependOn(t: TestDb, api: string, web: string): Promise<void> {
  const parent = await emptyChat(t, 'Orders launch');
  await t.db.query('UPDATE conversations SET title = $2 WHERE id = $1', [api, STACK_PARENT_TITLE]);
  await subChatOf(t, parent, api, null);
  await subChatOf(t, parent, web, api);
}

export async function stackedPair(t: TestDb, root: string, webRoot = root): Promise<StackedPair> {
  const projectId = (await createProject(t.db, t.workspaceId, root)).project.id;
  const webProject = (await createProject(t.db, t.workspaceId, webRoot)).project.id;
  const api = await projectChat(t, projectId);
  const web = await projectChat(t, webProject);
  await dependOn(t, api, web);
  return { projectId, api, web };
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

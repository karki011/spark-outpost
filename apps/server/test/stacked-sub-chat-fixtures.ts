import { primaryChatWorktree, type ChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { withTransaction } from '../src/persistence/db.ts';
import { insertSubChat } from '../src/persistence/sub-chats.ts';
import { createProject } from '../src/projects/projects.ts';
import { git, repoWithRemote, type TestRepo } from './ship-support.ts';
import { projectChat } from './stack-support.ts';
import { STARTED_WITH } from './sub-chat-fixtures.ts';
import type { TestDb } from './support.ts';
import { driveToEnd, openChat, sendMessage } from './turn-support.ts';
import { startTurnWorker } from './turn-worker.ts';

const BUILD = 'The divider shows the wrong day after midnight. Fix it. #build';

export const KEPT_FILE = 'notes.txt';

export interface Stack {
  repo: TestRepo;
  parent: string;
  web: string;
  base: ChatWorktree;
}

async function asSubChat(
  t: TestDb,
  parent: string,
  chat: string,
  stackedOn: string | null,
): Promise<void> {
  await withTransaction(t.db, (client) =>
    insertSubChat(client, {
      conversationId: chat,
      parentConversationId: parent,
      task: 'Build the page.',
      stackedOn,
      startsAfter: [],
      startedWith: STARTED_WITH,
      approvalId: null,
    }),
  );
}

async function keepChanges(t: TestDb, chat: string): Promise<void> {
  const worker = startTurnWorker(t);
  try {
    const runId = await sendMessage(t, chat, BUILD, { permission: 'do' });
    await driveToEnd(t, chat, runId, undefined, 90_000);
  } finally {
    await worker.stop();
  }
}

export async function stackAtAutomatic(
  t: TestDb,
  base: string,
  name: string,
  childRoot?: string,
): Promise<Stack> {
  const repo = await repoWithRemote(base, name);
  const parent = await openChat(t, { root: repo.root });
  const api = await openChat(t, { root: repo.root, level: 'hands-off' });
  await asSubChat(t, parent, api, null);
  await t.db.query('UPDATE sub_chats SET started_at = now() WHERE conversation_id = $1', [api]);
  await keepChanges(t, api);
  const tree = (await primaryChatWorktree(t.db, api))!;
  const childProject = childRoot
    ? (await createProject(t.db, t.workspaceId, childRoot)).project.id
    : tree.projectId;
  const web = await projectChat(t, childProject);
  await asSubChat(t, parent, web, api);
  return { repo, parent, web, base: tree };
}

export function uncommitted(tree: ChatWorktree): string {
  return git(tree.path, 'status', '--porcelain');
}

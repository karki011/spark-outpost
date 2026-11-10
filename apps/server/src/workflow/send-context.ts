import type { ApprovalRequest } from '../approvals/decide.ts';
import type { OwnRepo } from '../approvals/own-repo.ts';
import { sendsContent } from '../approvals/secret-send.ts';
import type { Queryable } from '../persistence/db.ts';
import { prFollowUpSettings } from '../persistence/pr-settings.ts';
import { pickRemote } from '../ship/git.ts';
import { parseRemoteUrl, repoSlug } from '../ship/remote.ts';
import { taskBranch } from './publish-context.ts';

interface OpenPull {
  number: number;
  workspace_id: string;
  known_reviewers: string[];
}

async function ownOpenPull(db: Queryable, runId: string, branch: string): Promise<OpenPull | null> {
  const { rows } = await db.query<OpenPull>(
    `SELECT w.number, w.workspace_id, w.known_reviewers FROM pr_watches w
     JOIN runs r ON r.conversation_id = w.conversation_id
     WHERE r.id = $1 AND w.branch = $2 AND w.pr_state = 'open'
       AND w.follow_up AND w.task_id IS NOT NULL
     ORDER BY w.created_at DESC LIMIT 1`,
    [runId, branch],
  );
  const pull = rows[0];
  if (!pull) return null;
  const settings = await prFollowUpSettings(db, pull.workspace_id);
  return settings.enabled && !settings.ask ? pull : null;
}

async function ownBranch(db: Queryable, root: string): Promise<string | null> {
  const task = await taskBranch(db, root).catch(() => null);
  if (!task || task.protectedBranches.includes(task.branch)) return null;
  return task.branch;
}

export async function ownRepoFor(
  db: Queryable,
  runId: string,
  request: ApprovalRequest,
): Promise<OwnRepo | null> {
  const root = request.roots[0]?.path;
  if (!root || !request.command || !sendsContent(request.command)) return null;
  const branch = await ownBranch(db, root);
  const remote = await pickRemote(root, branch).catch(() => null);
  const hosted = remote ? parseRemoteUrl(remote.url) : null;
  if (!hosted) return null;
  const pull = branch ? await ownOpenPull(db, runId, branch).catch(() => null) : null;
  return {
    host: hosted.host.toLowerCase(),
    slug: repoSlug(hosted).toLowerCase(),
    branch,
    pull: pull?.number ?? null,
    reviewers: pull?.known_reviewers ?? [],
  };
}

import { z } from 'zod';
import { SPARK_ACTION_KIND, type LinkRepoAction } from '@spark-outpost/contracts';
import type { Queryable } from '../../persistence/db.ts';
import { findRepos, linkTarget, LinkRefusedError } from '../../projects/repo-lookup.ts';
import { sparkReposRules } from '../../projects/repos-folders.ts';
import { runFromDevice } from '../../remote/run-mark.ts';
import { remoteAccess } from '../../remote/store.ts';
import {
  actionRun,
  IN_PROGRESS_MESSAGE,
  proposeAction,
  WAITING_MESSAGE,
} from '../actions/confirm.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';

export const FIND_REPO_TOOL = 'spark_find_repo';
export const LINK_REPO_TOOL = 'spark_link_repo';

const PARTIAL_NOTE = 'The scan stopped early, so some repos may be missing.';
export const REMOTE_REFUSAL =
  'A turn started on a paired device links a repo only while Link a new folder or clone a repo is on in Remote control on the Mac.';

export interface OpenCard {
  id: string;
  running: boolean;
}

export async function openRepoCard(
  db: Queryable,
  conversationId: string,
  action: 'link_repo' | 'clone_repo',
  field: 'path' | 'repo',
  value: string,
): Promise<OpenCard | null> {
  const { rows } = await db.query<{ id: string; status: string }>(
    `SELECT a.id, a.status FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.conversation_id = $1 AND a.kind = $2
       AND (a.status = 'pending' OR (a.status = 'allowed'
         AND a.payload->'sparkResult'->>'state' IN ('waiting', 'running')))
       AND a.payload->'sparkAction'->>'action' = $3
       AND a.payload->'sparkAction'->>$4 = $5
     ORDER BY a.created_at DESC LIMIT 1`,
    [conversationId, SPARK_ACTION_KIND, action, field, value],
  );
  const row = rows[0];
  return row ? { id: row.id, running: row.status !== 'pending' } : null;
}

export function openCardResult(card: OpenCard) {
  return {
    outcome: card.running ? 'in_progress' : 'waiting_for_user',
    approvalId: card.id,
    message: card.running ? IN_PROGRESS_MESSAGE : WAITING_MESSAGE,
  };
}

export async function refusedFromDevice(
  context: SparkToolContext,
  runId: string,
): Promise<boolean> {
  const { db } = context.deps;
  if (!(await runFromDevice(db, runId))) return false;
  return !(await remoteAccess(db, context.scope.workspaceId)).switches.projects;
}

export async function link(repo: string, context: SparkToolContext) {
  const run = actionRun(context.scope);
  const conversationId = context.scope.conversationId;
  if (!conversationId) throw new SparkToolError('Repos are linked only to a chat.');
  if (await refusedFromDevice(context, run.runId)) throw new SparkToolError(REMOTE_REFUSAL);
  const { db } = context.deps;
  const target = await linkTarget(db, context.scope.workspaceId, repo, sparkReposRules()).catch(
    (error: unknown) => {
      throw error instanceof LinkRefusedError ? new SparkToolError(error.message) : error;
    },
  );
  const open = await openRepoCard(db, conversationId, 'link_repo', 'path', target.path);
  if (open) return openCardResult(open);
  const action: LinkRepoAction = { action: 'link_repo', ...target };
  return proposeAction(context, action, { path: 'confirm', audit: { path: target.path } });
}

export const findRepoTool = sparkTool({
  name: FIND_REPO_TOOL,
  title: 'Find a repo',
  description:
    'Finds a git repo on this Mac by folder or origin name (partial ok): Spark projects, then repos folders. If several match, ask which.',
  input: { name: z.string().trim().min(1).max(200) },
  run: async ({ name }, { deps, scope }) => {
    const found = await findRepos(
      deps.db,
      scope.workspaceId,
      scope.conversationId,
      name,
      sparkReposRules(),
    );
    return { ...found, ...(found.partial ? { note: PARTIAL_NOTE } : {}) };
  },
});

export const linkRepoTool = sparkTool({
  name: LINK_REPO_TOOL,
  acts: true,
  title: 'Link a repo to this chat',
  description:
    'Asks to link a repo (path from spark_find_repo, or a project name) to this chat. Always a card; it applies from the next message.',
  input: { repo: z.string().trim().min(1).max(4096) },
  run: ({ repo }, context) => link(repo, context),
});

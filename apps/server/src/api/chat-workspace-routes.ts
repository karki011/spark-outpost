import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Router, type Response } from 'express';
import {
  updateChatWorkspaceRequestSchema,
  type BringChangesResult,
  type ChatWorkspace,
  type ProjectBranches,
} from '@spark-outpost/contracts';
import {
  placeChoice,
  primaryChatWorktree,
  saveLanded,
  savePlaceChoice,
  type ChatWorktree,
} from '../persistence/chat-worktrees.ts';
import type { Db } from '../persistence/db.ts';
import { bringChanges, currentBranch, listBranches } from '../projects/chat-worktrees.ts';
import { getProject } from '../projects/projects.ts';
import { isGitWorkTree } from '../projects/snapshot.ts';
import { paramId, parseBody } from './validation.ts';

const run = promisify(execFile);

export type OpenFolder = (path: string) => Promise<void>;

export interface ChatWorkspaceDeps {
  db: Db;
  workspaceId: string;
  openFolder?: OpenFolder;
}

const OPENERS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'open',
  win32: 'explorer',
};

export async function openInFileManager(path: string): Promise<void> {
  await run(OPENERS[process.platform] ?? 'xdg-open', [path]);
}

async function primaryProjectId(db: Db, conversationId: string): Promise<string | null> {
  const { rows } = await db.query<{ project_id: string }>(
    `SELECT project_id FROM conversation_projects WHERE conversation_id = $1
     ORDER BY position, created_at LIMIT 1`,
    [conversationId],
  );
  return rows[0]?.project_id ?? null;
}

function branchView(record: ChatWorktree | null): ChatWorkspace['current'] {
  if (!record) return null;
  return {
    projectId: record.projectId,
    branch: record.branch,
    path: record.path,
    worktree: !record.inPlace,
    owned: record.ownsBranch,
    baseBranch: record.baseBranch,
  };
}

async function workspaceOf(db: Db, conversationId: string): Promise<ChatWorkspace> {
  const projectId = await primaryProjectId(db, conversationId);
  const choice = await placeChoice(db, conversationId, projectId);
  const current = await primaryChatWorktree(db, conversationId);
  return { place: choice.place, requestedBranch: choice.branch, current: branchView(current) };
}

function conflict(res: Response, message: string): void {
  res.status(409).json({ error: message });
}

function list(files: readonly string[]): string {
  const shown = files.slice(0, 3).join(', ');
  return files.length > 3 ? `${shown} and ${files.length - 3} more` : shown;
}

async function bring(db: Db, record: ChatWorktree): Promise<BringChangesResult | string> {
  const outcome = await bringChanges(
    record.repoRoot,
    record.path,
    record.landedCommit ?? record.baseCommit,
  );
  const into = await currentBranch(record.repoRoot);
  const target = into ?? 'your checkout';
  if (outcome.status === 'dirty') {
    return `Your checkout has uncommitted changes (${list(outcome.files)}). Commit or stash them, then bring the changes into ${target}.`;
  }
  if (outcome.status === 'conflict') {
    return `These files changed both here and in ${target}: ${list(outcome.files)}. Nothing was changed; open a draft PR or merge ${record.branch} yourself.`;
  }
  if (outcome.status === 'nothing') return `There are no new changes to bring into ${target}.`;
  await saveLanded(db, record.id, outcome.result);
  return { into, files: outcome.files };
}

export function chatWorkspaceRoutes({ db, workspaceId, openFolder }: ChatWorkspaceDeps): Router {
  const router = Router();
  const open = openFolder ?? openInFileManager;

  router.get('/conversations/:id/workspace', async (req, res) => {
    res.json(await workspaceOf(db, paramId(req)));
  });

  router.put('/conversations/:id/workspace', async (req, res) => {
    const change = parseBody(updateChatWorkspaceRequestSchema, req);
    const id = paramId(req);
    const current = await primaryChatWorktree(db, id);
    if (current) {
      conflict(res, `This chat already works on ${current.branch}.`);
      return;
    }
    await savePlaceChoice(db, id, await primaryProjectId(db, id), change);
    res.json(await workspaceOf(db, id));
  });

  router.post('/conversations/:id/workspace/open', async (req, res) => {
    const current = await primaryChatWorktree(db, paramId(req));
    if (!current) {
      conflict(res, 'This chat has no worktree yet.');
      return;
    }
    await open(current.path);
    res.status(204).end();
  });

  router.post('/conversations/:id/workspace/bring', async (req, res) => {
    const current = await primaryChatWorktree(db, paramId(req));
    if (!current || current.inPlace) {
      conflict(res, 'This chat works in your checkout, so its changes are already there.');
      return;
    }
    const result = await bring(db, current);
    if (typeof result === 'string') {
      conflict(res, result);
      return;
    }
    res.json(result);
  });

  router.get('/projects/:id/branches', async (req, res) => {
    const project = await getProject(db, workspaceId, paramId(req));
    const empty: ProjectBranches = { current: null, local: [], remote: [] };
    if (!(await isGitWorkTree(project.rootPath))) {
      res.json(empty);
      return;
    }
    const branches = await listBranches(project.rootPath);
    const local = new Set(branches.local);
    const remote = [...branches.remote.keys()].filter((branch) => !local.has(branch));
    res.json({ current: branches.current, local: branches.local, remote });
  });

  return router;
}

import {
  GIT_INSTALL_HINT,
  type ShipBlock,
  type ShipFile,
  type ShipMode,
  type ShipPreview,
  type ShipSkippedFile,
  type TaskDetail,
} from '@spark-outpost/contracts';
import { getTaskShip, shipState, type TaskShip } from '../persistence/task-ships.ts';
import { getTaskDetail } from '../persistence/task-views.ts';
import { TaskNotFoundError } from '../persistence/tasks.ts';
import { chatWorktreeAt } from '../persistence/chat-worktrees.ts';
import { taskChanges } from '../projects/task-changes.ts';
import { shipBranchName } from './branch.ts';
import { shipCandidates } from './files.ts';
import {
  branchExists,
  branchTip,
  filesAgainst,
  gitInstalled,
  pendingFiles,
  pickRemote,
  remoteDefaultBranch,
  remoteHasBranch,
  repoState,
  type Remote,
  type RepoState,
} from './git.ts';
import { connectionFor, type GitHubDeps } from './github/access.ts';
import type { GitHubConnection } from './github/connection.ts';
import { parseRemoteUrl, repoSlug, type RemoteRepo } from './remote.ts';
import { shipTaskFacts, type ShipTaskFacts } from './task-facts.ts';

export interface ShipDeps extends GitHubDeps {
  branchPrefix: string;
}

export class ShipBlockedError extends Error {}

export interface ShipOptions {
  keepCheckout?: boolean;
  duringRun?: boolean;
  notes?: readonly string[];
}

export interface ShipPlan {
  task: TaskDetail;
  facts: ShipTaskFacts | null;
  root: string | null;
  repo: RepoState | null;
  branch: string;
  branchExists: boolean;
  baseBranch: string | null;
  files: ShipFile[];
  skipped: ShipSkippedFile[];
  shipped: TaskShip | null;
  remote: Remote | null;
  remoteRepo: RemoteRepo | null;
  github: GitHubConnection | null;
  blocked: ShipBlock | null;
  modes: ShipMode[];
  notes: string[];
  keepCheckout: boolean;
  paths: string[];
}

const block = (reason: ShipBlock['reason'], message: string): ShipBlock => ({ reason, message });

export const BLOCKED = {
  gitMissing: block('git_missing', GIT_INSTALL_HINT),
  running: block('running', 'The task is still working. Ship it after it finishes.'),
  noChanges: block('no_changes', 'This task has no file changes to ship.'),
  severalFolders: block(
    'several_folders',
    'This task changed files in more than one folder, so Ship can’t commit it as one.',
  ),
  unmergedCopy: block(
    'unmerged_copy',
    'A copy of this task hasn’t merged back yet. Ship it after the task finishes.',
  ),
  notRepo: block('not_repo', 'This folder isn’t a Git repository, so there is nothing to commit.'),
  noCommits: block(
    'no_commits',
    'This repository has no commits yet. Make a first commit, then ship.',
  ),
  nothingNew: block(
    'nothing_new',
    'Nothing to ship: the task’s files have no uncommitted changes.',
  ),
};

function switchFirst(branch: string, current: string | null): ShipBlock {
  return block(
    'switch_branch',
    `Ship committed this task on ${branch}, but you’re on ${current ?? 'a detached HEAD'}. Switch to ${branch} to ship more changes.`,
  );
}

async function baseBranch(
  root: string,
  remote: Remote | null,
  current: string | null,
  branch: string,
): Promise<string | null> {
  if (!remote) return null;
  if (current && current !== branch && (await remoteHasBranch(root, remote.name, current))) {
    return current;
  }
  return remoteDefaultBranch(root, remote.name);
}

function modeNotes(plan: Pick<ShipPlan, 'remote' | 'remoteRepo' | 'github' | 'skipped'>) {
  const notes: string[] = [];
  if (!plan.remote) notes.push('This repository has no remote, so Ship can only commit.');
  else if (!plan.remoteRepo)
    notes.push('The remote isn’t on GitHub, so Ship can push but not open a PR.');
  else if (!plan.github) {
    notes.push(
      plan.remoteRepo.host === 'github.com'
        ? 'Connect GitHub in Settings → Connectors (gh CLI or a token) to open a pull request.'
        : `No GitHub login for ${plan.remoteRepo.host}, so Ship can push but not open a PR.`,
    );
  }
  if (plan.skipped.length > 0) {
    notes.push(
      `${plan.skipped.length} file${plan.skipped.length === 1 ? '' : 's'} left out: ${plan.skipped.map((file) => file.path).join(', ')}.`,
    );
  }
  return notes;
}

function modesFor(plan: Pick<ShipPlan, 'files' | 'remote' | 'remoteRepo' | 'github'>): ShipMode[] {
  const modes: ShipMode[] = plan.files.length > 0 ? ['commit'] : [];
  if (plan.remote) modes.push('push');
  if (plan.remoteRepo && plan.github) modes.push('draft_pr');
  return modes;
}

function blockedPlan(
  base: Pick<ShipPlan, 'task' | 'branch' | 'shipped'> & Partial<ShipPlan>,
  blocked: ShipBlock,
): ShipPlan {
  return {
    facts: null,
    root: null,
    repo: null,
    branchExists: false,
    baseBranch: null,
    files: [],
    skipped: [],
    remote: null,
    remoteRepo: null,
    github: null,
    notes: [],
    keepCheckout: false,
    paths: [],
    ...base,
    blocked,
    modes: [],
  };
}

export async function planShip(
  deps: ShipDeps,
  taskId: string,
  options: ShipOptions = {},
): Promise<ShipPlan> {
  const task = await getTaskDetail(deps.db, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  const shipped = await getTaskShip(deps.db, taskId);
  const branch = shipped?.branch ?? shipBranchName(deps.branchPrefix, task.title, task.id);
  const keepCheckout = options.keepCheckout ?? shipped?.keepsCheckout ?? false;
  const start = { task, branch, shipped, keepCheckout };
  if (!(await gitInstalled())) return blockedPlan(start, BLOCKED.gitMissing);
  const facts = await shipTaskFacts(deps.db, taskId);
  if (facts.running && !options.duringRun) {
    return blockedPlan({ ...start, facts }, BLOCKED.running);
  }
  if (facts.roots.length > 1 && !shipped) return blockedPlan(start, BLOCKED.severalFolders);
  if (facts.unmergedCopy) return blockedPlan(start, BLOCKED.unmergedCopy);
  const root = shipped?.rootPath ?? facts.roots[0] ?? null;
  if (!root) return blockedPlan(start, BLOCKED.noChanges);
  const chat = await chatWorktreeAt(deps.db, root);
  if (!chat) return planFrom(deps, start, facts, root, null);
  const onChat = { ...start, branch: chat.branch, keepCheckout: false };
  return planFrom(deps, onChat, facts, root, chat.baseBranch);
}

async function planFrom(
  deps: ShipDeps,
  start: Pick<ShipPlan, 'task' | 'branch' | 'shipped' | 'keepCheckout'>,
  facts: ShipTaskFacts,
  root: string,
  baseHint: string | null,
): Promise<ShipPlan> {
  const { shipped, branch, keepCheckout } = start;
  const taskId = start.task.id;
  const repo = await repoState(root);
  if (!repo) return blockedPlan({ ...start, root }, BLOCKED.notRepo);
  if (!repo.head) return blockedPlan({ ...start, root, repo }, BLOCKED.noCommits);

  const candidates = shipCandidates(await taskChanges(deps.db, deps.workspaceId, taskId));
  const exists = await branchExists(root, branch);
  const files = keepCheckout
    ? await filesAgainst(
        root,
        repo.prefix,
        candidates.paths,
        (exists ? await branchTip(root, branch) : null) ?? repo.head,
      )
    : await pendingFiles(root, repo.prefix, candidates.paths);
  const context = {
    ...start,
    facts,
    root,
    repo,
    files,
    skipped: candidates.skipped,
    paths: candidates.paths,
  };
  if (files.length === 0 && !exists) return blockedPlan(context, BLOCKED.nothingNew);
  if (!keepCheckout && files.length > 0 && exists && repo.branch !== branch) {
    return blockedPlan(context, switchFirst(branch, repo.branch));
  }

  const remote = await pickRemote(root, repo.branch);
  const parsed = remote ? parseRemoteUrl(remote.url) : null;
  const github = parsed ? await connectionFor(deps, parsed.host) : null;
  const remoteRepo = parsed && (parsed.host === 'github.com' || github) ? parsed : null;
  const plan: ShipPlan = {
    ...context,
    branchExists: exists,
    baseBranch:
      shipped?.baseBranch ?? (await baseBranch(root, remote, baseHint ?? repo.branch, branch)),
    remote,
    remoteRepo,
    github,
    blocked: null,
    modes: [],
    notes: [],
  };
  return { ...plan, modes: modesFor(plan), notes: modeNotes(plan) };
}

export function previewOf(plan: ShipPlan): ShipPreview {
  return {
    branch: plan.branch,
    baseBranch: plan.baseBranch,
    title: plan.task.title,
    files: plan.files,
    skipped: plan.skipped,
    remote: plan.remote
      ? {
          name: plan.remote.name,
          host: plan.remoteRepo?.host ?? parseRemoteUrl(plan.remote.url)?.host ?? null,
          repo: plan.remoteRepo ? repoSlug(plan.remoteRepo) : null,
          github: plan.remoteRepo !== null,
        }
      : null,
    modes: plan.modes,
    blocked: plan.blocked,
    notes: plan.notes,
    github: plan.github ? { method: plan.github.method, host: plan.github.host } : null,
    shipped: shipState(plan.shipped),
  };
}

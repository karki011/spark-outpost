import type { AdoptPullRequest, OpenPull, OpenPulls } from '@spark-outpost/contracts';
import { createCopy, type Planned } from '../orchestration/chat-place.ts';
import {
  liveChatWorktree,
  repointChatWorktree,
  saveAdoption,
  type ChatWorktree,
} from '../persistence/chat-worktrees.ts';
import type { Db } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import { insertTask } from '../persistence/tasks.ts';
import { trackPull } from '../persistence/tracked-pulls.ts';
import { shipBranchName } from '../ship/branch.ts';
import { parsePullUrl } from '../tickets/pull-status.ts';
import { pickRemote, remotes } from '../ship/git.ts';
import { parseRemoteUrl, type RemoteRepo } from '../ship/remote.ts';
import { adoptedNote, adoptPlan, forkRemoteName, type AdoptPlan } from './adopt-plan.ts';
import { inPlaceRefusal, switchInPlace } from './adopt-in-place.ts';
import {
  branchCheckedOut,
  currentBranch,
  defaultBranch,
  isAncestor,
  listBranches,
} from './chat-worktrees.ts';
import {
  listOpenPulls,
  protectedOnHost,
  viewPull,
  type FoundPull,
  type GhRunner,
  type HeadRepo,
} from './open-pulls.ts';
import { getProject } from './projects.ts';
import type { WorktreeSource } from './chat-worktrees.ts';
import { git, isGitWorkTree } from './snapshot.ts';
import { prepareDependencies } from './worktree-deps.ts';

export class AdoptError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export interface AdoptDeps {
  db: Db;
  workspaceId: string;
  branchPrefix: string;
  runner: () => Promise<GhRunner | null>;
}

const NO_GH = 'Install the GitHub CLI (gh) and sign in with gh auth login to list pull requests.';
const NO_REMOTE = "This project's repository has no GitHub remote.";
export const OTHER_REPO =
  "That pull request is in another repository than this chat's project, so this chat can't work on it.";

function sameRepoUrl(url: string, repo: RemoteRepo, number: number): boolean {
  const parsed = parsePullUrl(url);
  return (
    parsed !== null &&
    parsed.number === number &&
    parsed.host.toLowerCase() === repo.host.toLowerCase() &&
    parsed.owner.toLowerCase() === repo.owner.toLowerCase() &&
    parsed.name.toLowerCase() === repo.name.toLowerCase()
  );
}

interface Hosted {
  root: string;
  origin: { name: string; url: string };
  repo: RemoteRepo;
  runner: GhRunner;
}

async function hosted(deps: AdoptDeps, root: string): Promise<Hosted | string> {
  if (!(await isGitWorkTree(root))) return NO_REMOTE;
  const origin = await pickRemote(root, null).catch(() => null);
  const repo = origin ? parseRemoteUrl(origin.url) : null;
  if (!origin || !repo) return NO_REMOTE;
  const runner = await deps.runner();
  if (!runner) return NO_GH;
  return { root, origin, repo, runner };
}

export async function openPullsFor(deps: AdoptDeps, projectId: string): Promise<OpenPulls> {
  const project = await getProject(deps.db, deps.workspaceId, projectId);
  const found = await hosted(deps, project.rootPath);
  if (typeof found === 'string') return { pulls: [], problem: found };
  return listOpenPulls(found.runner, found.repo);
}

async function linkedProject(deps: AdoptDeps, conversationId: string, projectId: string) {
  const { rows } = await deps.db.query<{ root_path: string }>(
    `SELECT p.root_path FROM conversation_projects cp
     JOIN projects p ON p.id = cp.project_id
     JOIN conversations c ON c.id = cp.conversation_id
     WHERE cp.conversation_id = $1 AND cp.project_id = $2 AND c.workspace_id = $3`,
    [conversationId, projectId, deps.workspaceId],
  );
  const root = rows[0]?.root_path;
  if (!root) throw new AdoptError(404, "That project isn't linked to this chat.");
  return root;
}

function forkUrl(originUrl: string, repo: RemoteRepo, head: HeadRepo): string | null {
  const at = originUrl.toLowerCase().lastIndexOf(`${repo.owner}/${repo.name}`.toLowerCase());
  if (at === -1) return null;
  const end = at + repo.owner.length + 1 + repo.name.length;
  return `${originUrl.slice(0, at)}${head.owner}/${head.name}${originUrl.slice(end)}`;
}

async function forkRemote(found: Hosted, head: HeadRepo): Promise<string> {
  const name = forkRemoteName(head.owner);
  const url = forkUrl(found.origin.url, found.repo, head);
  if (!url) throw new AdoptError(409, "Spark couldn't work out the fork's address.");
  const existing = (await remotes(found.root)).find((remote) => remote.name === name);
  if (existing && existing.url !== url) {
    throw new AdoptError(409, `A remote named ${name} already points somewhere else.`);
  }
  if (!existing) await git(found.root, ['remote', 'add', name, url]);
  return name;
}

async function fetchRef(root: string, remote: string, ref: string): Promise<void> {
  await git(root, ['fetch', '--quiet', remote, ref]);
}

async function catchUpLocal(root: string, branch: string): Promise<void> {
  const tip = (await git(root, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])).trim();
  const local = (await git(root, ['rev-parse', '--verify', `refs/heads/${branch}`])).trim();
  if (local === tip) return;
  if (!(await isAncestor(root, local, tip))) {
    throw new AdoptError(
      409,
      `Your local branch ${branch} has commits that aren't on the pull request. Push or rename it, then try again.`,
    );
  }
  await git(root, ['branch', '--force', branch, tip]);
}

async function headSource(
  found: Hosted,
  pull: FoundPull,
  plan: Extract<AdoptPlan, { kind: 'head' }>,
) {
  const remote = plan.fork ? await forkRemote(found, pull.headRepo) : found.origin.name;
  await fetchRef(found.root, remote, plan.branch);
  if (plan.local) {
    await catchUpLocal(found.root, plan.branch);
    return { kind: 'existing' as const, branch: plan.branch };
  }
  return { kind: 'remote' as const, branch: plan.branch, ref: `${remote}/${plan.branch}` };
}

async function basedSource(deps: AdoptDeps, found: Hosted, pull: OpenPull, conversationId: string) {
  await fetchRef(found.root, found.origin.name, `pull/${pull.number}/head`);
  const from = (await git(found.root, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])).trim();
  const title = `pr ${pull.number} ${pull.title}`;
  const branch = shipBranchName(deps.branchPrefix, title, conversationId);
  if ((await listBranches(found.root)).local.includes(branch)) {
    return { kind: 'existing' as const, branch };
  }
  return { kind: 'new' as const, branch, from };
}

async function tracksFork(root: string, pull: FoundPull): Promise<boolean> {
  const remote = await git(root, ['config', '--get', `branch.${pull.pull.head}.remote`]).catch(
    () => '',
  );
  return remote.trim() === forkRemoteName(pull.headRepo.owner);
}

async function planFor(found: Hosted, pull: FoundPull, here: boolean): Promise<AdoptPlan> {
  const branches = await listBranches(found.root);
  const fallback = await defaultBranch(found.root).catch(() => null);
  const guarded = ['main', 'master', pull.pull.base, ...(fallback ? [fallback] : [])];
  const localBranch = branches.local.includes(pull.pull.head);
  return adoptPlan(pull.pull, {
    guarded,
    protectedOnHost: await protectedOnHost(found.runner, found.repo, pull.headRepo, pull.pull.head),
    localBranch,
    sameFork: localBranch && pull.pull.fork && (await tracksFork(found.root, pull)),
    checkedOut: !here && (await branchCheckedOut(found.root, pull.pull.head)),
  });
}

async function openTask(db: Db, conversationId: string, pull: OpenPull): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM tasks WHERE conversation_id = $1 AND status = 'open'
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [conversationId],
  );
  if (rows[0]) return rows[0].id;
  const taskId = newId();
  await insertTask(db, taskId, conversationId, `PR #${pull.number}: ${pull.title}`);
  return taskId;
}

async function switchedHere(
  deps: AdoptDeps,
  current: ChatWorktree,
  source: WorktreeSource,
  base: string,
  here: boolean,
): Promise<ChatWorktree> {
  const refusal = await inPlaceRefusal(deps.db, current);
  if (refusal) throw new AdoptError(409, refusal);
  if (here) {
    await repointChatWorktree(deps.db, current.id, {
      name: source.branch,
      base,
      commit: (await git(current.path, ['rev-parse', 'HEAD'])).trim(),
    });
  } else {
    await switchInPlace(deps.db, current, source, base);
  }
  return current;
}

async function newCopy(
  deps: AdoptDeps,
  target: { conversationId: string; projectId: string; root: string },
  source: WorktreeSource,
  pull: FoundPull,
): Promise<ChatWorktree> {
  const planned: Planned = { source, owned: true, baseBranch: pull.pull.base, baseRef: null };
  const placeDeps = {
    db: deps.db,
    branchPrefix: deps.branchPrefix,
    prepareLater: (job: { main: string; copy: string }) =>
      void prepareDependencies(job.main, job.copy, { root: job.main }).catch(() => null),
  };
  return (await createCopy(placeDeps, target, planned)).record;
}

export async function adoptPull(
  deps: AdoptDeps,
  conversationId: string,
  request: AdoptPullRequest,
): Promise<string> {
  const root = await linkedProject(deps, conversationId, request.projectId);
  const current = await liveChatWorktree(deps.db, conversationId, request.projectId);
  const refusal = current ? await inPlaceRefusal(deps.db, current) : null;
  if (refusal) throw new AdoptError(409, refusal);
  const found = await hosted(deps, root);
  if (typeof found === 'string') throw new AdoptError(409, found);
  if (request.url && !sameRepoUrl(request.url, found.repo, request.number)) {
    throw new AdoptError(409, OTHER_REPO);
  }
  const pull = await viewPull(found.runner, found.repo, request.number);
  if (!pull) throw new AdoptError(404, `Pull request #${request.number} wasn't found.`);
  if (!pull.open) throw new AdoptError(409, `Pull request #${request.number} isn't open.`);
  const here = current !== null && (await currentBranch(current.path)) === pull.pull.head;
  const plan = await planFor(found, pull, here);
  if (plan.kind === 'busy') throw new AdoptError(409, plan.why);
  const stay = here && plan.kind === 'head';
  const source = stay
    ? { kind: 'existing' as const, branch: pull.pull.head }
    : plan.kind === 'head'
      ? await headSource(found, pull, plan)
      : await basedSource(deps, found, pull.pull, conversationId);
  const record = current
    ? await switchedHere(deps, current, source, pull.pull.base, stay)
    : await newCopy(deps, { conversationId, projectId: request.projectId, root }, source, pull);
  const pushes = plan.kind === 'head';
  const { number, author, url, head } = pull.pull;
  await saveAdoption(deps.db, record.id, { number, author, url, head, pushes });
  const taskId = await openTask(deps.db, conversationId, pull.pull);
  await trackPull(deps.db, {
    workspaceId: deps.workspaceId,
    conversationId,
    taskId,
    host: found.repo.host,
    owner: found.repo.owner,
    repo: found.repo.name,
    number,
    url,
    branch: head,
    via: 'adopted',
    by: author,
    runId: null,
    outside: false,
    followUp: pushes,
    title: pull.pull.title,
    base: pull.pull.base,
  });
  const note = plan.kind === 'head' ? adoptedNote(pull.pull, plan, pull.headRepo.owner) : plan.why;
  return current && !stay ? `${note} Earlier work in this chat stays on ${current.branch}.` : note;
}

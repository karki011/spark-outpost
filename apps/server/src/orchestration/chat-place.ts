import { access } from 'node:fs/promises';
import path from 'node:path';
import { UNTITLED_CONVERSATION } from '@spark-outpost/contracts';
import {
  insertChatWorktree,
  liveChatWorktree,
  markChatWorktreeRemoved,
  placeChoice,
  type ChatWorktree,
} from '../persistence/chat-worktrees.ts';
import type { Db, Queryable } from '../persistence/db.ts';
import type { Lease } from '../persistence/jobs.ts';
import { newId } from '../persistence/ids.ts';
import { stackParentOf, type StackParent } from '../outposts/stack-base.ts';
import {
  addChatWorktree,
  branchCheckedOut,
  branchTipOf,
  changedFiles,
  defaultBranch,
  freshRemoteDefault,
  isAncestor,
  listBranches,
  type BranchList,
  type WorktreeSource,
} from '../projects/chat-worktrees.ts';
import { git, headCommit, isGitWorkTree } from '../projects/snapshot.ts';
import { prepareDependencies, type DepsPrep } from '../projects/worktree-deps.ts';
import { DEFAULT_BRANCH_PREFIX, repoTop, worktreePath } from '../projects/worktrees.ts';
import { shipBranchName } from '../ship/branch.ts';
import { ticketBranchTitle } from '../tickets/chat-link.ts';
import { gitInstalled } from '../ship/git.ts';
import type { Append } from '../workflow/agent-turn.ts';
import { planNote } from '../workflow/plan-recorder.ts';
import { runEvents } from '../workflow/run-events.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { auditDepsPrep, depsNote, installingNote } from './deps-audit.ts';
import { decidePlace, namedBranch, type PlaceDecision, type StackOn } from './place-decision.ts';

const WORKTREE_FAILED =
  "Couldn't set up a worktree for this chat, so nothing was changed. Choose Edit my files to work in place.";

const GIT_MISSING_NOTE =
  'Git isn’t installed, so this chat works directly in your folder instead of its own worktree. Install Apple’s command line tools with xcode-select --install, then start a new chat to give it its own copy.';

interface ChatPlaceDeps {
  db: Queryable;
  branchPrefix: string;
  gitInstalled?: () => Promise<boolean>;
  onInstall?: (command: string) => void;
}

interface PlacedChat {
  input: RunInput;
  repoRoot: string | null;
  note: string | null;
  deps?: { prep: DepsPrep; copy: string };
}

interface Target {
  conversationId: string;
  projectId: string;
  root: string;
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}

function inCopy(input: RunInput, record: ChatWorktree): RunInput {
  if (record.inPlace) return input;
  return {
    ...input,
    projectRoots: [record.path, ...input.projectRoots.slice(1)],
    chatWorktree: true,
  };
}

async function branchTitle(db: Queryable, conversationId: string, request: string) {
  const { rows } = await db.query<{ title: string; title_source: string }>(
    'SELECT title, title_source FROM conversations WHERE id = $1',
    [conversationId],
  );
  const row = rows[0];
  const titled = row && row.title !== UNTITLED_CONVERSATION && row.title_source === 'user';
  const title = titled ? row.title : request.slice(0, 80);
  return ticketBranchTitle(db, conversationId, title);
}

interface StartPoint {
  from: string;
  baseRef: string;
}

async function upToDateBase(root: string, head: string | null): Promise<StartPoint | null> {
  const remote = await freshRemoteDefault(root);
  if (!remote || (head && !(await isAncestor(root, head, remote)))) return null;
  const commit = (await git(root, ['rev-parse', '--verify', '-q', `${remote}^{commit}`])).trim();
  return commit ? { from: commit, baseRef: remote } : null;
}

async function startPoint(
  root: string,
  branches: BranchList,
  from: string | null,
): Promise<StartPoint | null> {
  if (from) return { from, baseRef: from };
  const head = await headCommit(root);
  const fresh = await upToDateBase(root, head);
  if (fresh) return fresh;
  if (branches.current) return { from: head ?? branches.current, baseRef: branches.current };
  const fallback = (await defaultBranch(root)) ?? head;
  return fallback ? { from: fallback, baseRef: fallback } : null;
}

interface Planned {
  source: WorktreeSource;
  owned: boolean;
  baseBranch: string | null;
  baseRef: string | null;
}

async function plannedSource(
  deps: ChatPlaceDeps,
  target: Target,
  request: string,
  branches: BranchList,
  decision: Exclude<PlaceDecision, { kind: 'checkout' } | { kind: 'in_place' }>,
): Promise<Planned | null> {
  if (decision.kind === 'existing') {
    return { source: decision, owned: false, baseBranch: decision.branch, baseRef: null };
  }
  if (decision.kind === 'remote') {
    return { source: decision, owned: false, baseBranch: decision.branch, baseRef: decision.ref };
  }
  const title = await branchTitle(deps.db, target.conversationId, request);
  const branch = shipBranchName(deps.branchPrefix, title, target.conversationId);
  const baseBranch = decision.from ?? branches.current ?? (await defaultBranch(target.root));
  if (branches.local.includes(branch)) {
    return { source: { kind: 'existing', branch }, owned: true, baseBranch, baseRef: null };
  }
  const start = await startPoint(target.root, branches, decision.from);
  if (!start) return null;
  return {
    source: { kind: 'new', branch, from: start.from },
    owned: true,
    baseBranch,
    baseRef: start.baseRef,
  };
}

async function baseCommitOf(root: string, source: WorktreeSource): Promise<string | null> {
  if (source.kind === 'new') {
    const commit = await git(root, ['rev-parse', '--verify', '-q', `${source.from}^{commit}`]);
    return commit.trim() || null;
  }
  if (source.kind === 'existing') return branchTipOf(root, source.branch);
  return (await git(root, ['rev-parse', '--verify', '-q', `${source.ref}^{commit}`])).trim();
}

async function createCopy(
  deps: ChatPlaceDeps,
  target: Target,
  planned: Planned,
): Promise<{ record: ChatWorktree; prep: DepsPrep | null }> {
  const { root } = target;
  const top = await repoTop(root);
  const id = newId();
  const folder = worktreePath(root, id);
  const record: ChatWorktree = {
    id,
    conversationId: target.conversationId,
    projectId: target.projectId,
    repoRoot: root,
    path: path.join(folder, path.relative(top, root)),
    branch: planned.source.branch,
    baseBranch: planned.baseBranch,
    baseRef: planned.baseRef,
    baseCommit: (await baseCommitOf(root, planned.source)) ?? '',
    landedCommit: null,
    inPlace: false,
    ownsBranch: planned.owned,
  };
  await insertChatWorktree(deps.db, record);
  try {
    await addChatWorktree(root, folder, planned.source);
  } catch (error) {
    await markChatWorktreeRemoved(deps.db, id);
    throw error;
  }
  const prep = await prepareDependencies(root, record.path, {
    root,
    ...(deps.onInstall ? { onInstall: deps.onInstall } : {}),
  }).catch(() => null);
  return { record, prep };
}

async function restoreCopy(db: Queryable, record: ChatWorktree): Promise<boolean> {
  if (record.inPlace || (await exists(record.path))) return true;
  if (!(await branchTipOf(record.repoRoot, record.branch))) {
    await markChatWorktreeRemoved(db, record.id);
    return false;
  }
  const folder = worktreePath(record.repoRoot, record.id);
  await addChatWorktree(record.repoRoot, folder, { kind: 'existing', branch: record.branch });
  return true;
}

function placeNote(record: ChatWorktree, extra: string | null): string {
  const where = record.inPlace
    ? `Working on ${record.branch} in your checkout.`
    : `Working on ${record.branch} in this chat's worktree.`;
  return extra ? `${where} ${extra}` : where;
}

function stackOnOf(parent: StackParent | null): StackOn | null {
  return parent?.branch ? { branch: parent.branch, owner: parent.owner } : null;
}

function notStackedNote(parent: StackParent | null, decision: PlaceDecision): string | null {
  if (!parent || decision.kind !== 'new' || decision.from !== null) return null;
  return `${parent.owner} has no branch to build on, so this chat's branch does not start from ${parent.owner}'s work.`;
}

async function decide(deps: ChatPlaceDeps, target: Target, request: string) {
  const parent = await stackParentOf(deps.db, target.conversationId);
  const choice = await placeChoice(deps.db, target.conversationId, target.projectId);
  const branches = await listBranches(target.root);
  const known = new Set([...branches.local, ...branches.remote.keys()]);
  const requested = choice.branch ?? namedBranch(request, known);
  const clean = (await changedFiles(target.root)).length === 0;
  const decision = decidePlace({
    preference: choice.place,
    requested,
    current: branches.current,
    clean,
    local: branches.local,
    remote: branches.remote,
    checkedOutElsewhere: requested ? await branchCheckedOut(target.root, requested) : false,
    stackOn: stackOnOf(parent),
  });
  return { decision, branches, clean, notStacked: notStackedNote(parent, decision) };
}

async function inPlace(deps: ChatPlaceDeps, target: Target, branch: string) {
  const record: ChatWorktree = {
    id: newId(),
    conversationId: target.conversationId,
    projectId: target.projectId,
    repoRoot: target.root,
    path: target.root,
    branch,
    baseBranch: branch,
    baseCommit: (await headCommit(target.root)) ?? '',
    landedCommit: null,
    inPlace: true,
    ownsBranch: false,
  };
  await insertChatWorktree(deps.db, record);
  return record;
}

const DIRTY_NOTE = 'Uncommitted changes in your checkout are not part of it.';

async function freshPlace(deps: ChatPlaceDeps, input: RunInput, target: Target) {
  const { decision, branches, clean, notStacked } = await decide(deps, target, input.userRequest);
  if (decision.kind === 'checkout') return { input, repoRoot: target.root, note: decision.note };
  if (decision.kind === 'in_place') {
    const record = await inPlace(deps, target, decision.branch);
    return { input, repoRoot: target.root, note: placeNote(record, null) };
  }
  const planned = await plannedSource(deps, target, input.userRequest, branches, decision);
  if (!planned) return { input, repoRoot: target.root, note: null };
  const { record, prep } = await createCopy(deps, target, planned);
  const extra = decision.kind === 'new' ? decision.note : null;
  const fromHead = decision.kind === 'new' && decision.from === null;
  const dirty = fromHead && !clean ? DIRTY_NOTE : null;
  const said = [extra, notStacked, dirty, depsNote(prep)].filter(Boolean).join(' ') || null;
  return {
    input: inCopy(input, record),
    repoRoot: target.root,
    note: placeNote(record, said),
    ...(prep ? { deps: { prep, copy: record.path } } : {}),
  };
}

async function primaryProject(db: Queryable, conversationId: string) {
  const { rows } = await db.query<{ id: string; root_path: string }>(
    `SELECT p.id, p.root_path FROM conversation_projects cp JOIN projects p ON p.id = cp.project_id
     WHERE cp.conversation_id = $1 ORDER BY cp.position, cp.created_at LIMIT 1`,
    [conversationId],
  );
  return rows[0] ?? null;
}

export async function placeChat(
  deps: ChatPlaceDeps,
  input: RunInput,
  create: boolean,
): Promise<PlacedChat> {
  const conversationId = input.identity.threadId;
  const project = input.mode === 'do' ? await primaryProject(deps.db, conversationId) : null;
  if (!project) return { input, repoRoot: input.projectRoots[0] ?? null, note: null };
  const { id: projectId, root_path: root } = project;
  const existing = await liveChatWorktree(deps.db, conversationId, projectId);
  if (existing && (await restoreCopy(deps.db, existing))) {
    return { input: inCopy(input, existing), repoRoot: existing.repoRoot, note: null };
  }
  const plain = { ...input, projectRoots: [root, ...input.projectRoots.slice(1)] };
  if (!create) return { input: plain, repoRoot: root, note: null };
  if (!(await isGitWorkTree(root))) {
    const installed = await (deps.gitInstalled ?? gitInstalled)();
    return { input: plain, repoRoot: root, note: installed ? null : GIT_MISSING_NOTE };
  }
  return freshPlace(deps, plain, { conversationId, projectId, root });
}

type PlaceDeps = { db: Db; branchPrefix?: string };

export async function placeChatOrFailure(
  deps: PlaceDeps,
  input: RunInput,
  append: Append,
  create: boolean,
  lease: Lease | null = null,
): Promise<PlacedChat | { failed: string }> {
  try {
    const placed = await placeChat(
      {
        db: deps.db,
        branchPrefix: deps.branchPrefix ?? DEFAULT_BRANCH_PREFIX,
        onInstall: (command) => void planNote(append, installingNote(command)).catch(() => null),
      },
      input,
      create,
    );
    if (placed.note) await planNote(append, placed.note);
    if (placed.deps && lease) {
      await auditDepsPrep(deps.db, lease, placed.deps.prep, placed.deps.copy).catch(() => null);
    }
    return placed;
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { failed: `${WORKTREE_FAILED} ${reason}` };
  }
}

export async function placeChatOrStop(
  deps: PlaceDeps,
  input: RunInput,
  append: Append,
  create: boolean,
  lease: Lease | null = null,
): Promise<PlacedChat | null> {
  const placed = await placeChatOrFailure(deps, input, append, create, lease);
  if (!('failed' in placed)) return placed;
  await append(runEvents.error(placed.failed, 'orchestration_failed'), {
    transition: { status: 'failed', error: placed.failed },
  });
  return null;
}

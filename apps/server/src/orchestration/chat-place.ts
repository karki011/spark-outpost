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
import type { Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';
import {
  addChatWorktree,
  branchCheckedOut,
  branchTipOf,
  changedFiles,
  defaultBranch,
  listBranches,
  type BranchList,
  type WorktreeSource,
} from '../projects/chat-worktrees.ts';
import { git, headCommit, isGitWorkTree } from '../projects/snapshot.ts';
import { prepareDependencies } from '../projects/worktree-deps.ts';
import { DEFAULT_BRANCH_PREFIX, repoTop, worktreePath } from '../projects/worktrees.ts';
import { shipBranchName } from '../ship/branch.ts';
import { ticketBranchTitle } from '../tickets/chat-link.ts';
import { gitInstalled } from '../ship/git.ts';
import type { Append } from '../workflow/agent-turn.ts';
import { planNote } from '../workflow/plan-recorder.ts';
import { runEvents } from '../workflow/run-events.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { decidePlace, namedBranch, type PlaceDecision } from './place-decision.ts';

const WORKTREE_FAILED =
  "Couldn't set up a worktree for this chat, so nothing was changed. Choose Edit my files to work in place.";

const GIT_MISSING_NOTE =
  'Git isn’t installed, so this chat works directly in your folder instead of its own worktree. Install Apple’s command line tools with xcode-select --install, then start a new chat to give it its own copy.';

interface ChatPlaceDeps {
  db: Queryable;
  branchPrefix: string;
  gitInstalled?: () => Promise<boolean>;
}

interface PlacedChat {
  input: RunInput;
  repoRoot: string | null;
  note: string | null;
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

async function startPoint(root: string, branches: BranchList, from: string | null) {
  if (from) return from;
  if (branches.current) return (await headCommit(root)) ?? branches.current;
  return (await defaultBranch(root)) ?? (await headCommit(root));
}

interface Planned {
  source: WorktreeSource;
  owned: boolean;
  baseBranch: string | null;
}

async function plannedSource(
  deps: ChatPlaceDeps,
  target: Target,
  request: string,
  branches: BranchList,
  decision: Exclude<PlaceDecision, { kind: 'checkout' } | { kind: 'in_place' }>,
): Promise<Planned | null> {
  if (decision.kind === 'existing') {
    return { source: decision, owned: false, baseBranch: decision.branch };
  }
  if (decision.kind === 'remote') {
    return { source: decision, owned: false, baseBranch: decision.branch };
  }
  const title = await branchTitle(deps.db, target.conversationId, request);
  const branch = shipBranchName(deps.branchPrefix, title, target.conversationId);
  const baseBranch = decision.from ?? branches.current ?? (await defaultBranch(target.root));
  if (branches.local.includes(branch)) {
    return { source: { kind: 'existing', branch }, owned: true, baseBranch };
  }
  const from = await startPoint(target.root, branches, decision.from);
  if (!from) return null;
  return { source: { kind: 'new', branch, from }, owned: true, baseBranch };
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
): Promise<ChatWorktree> {
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
  await prepareDependencies(root, record.path, { root }).catch(() => null);
  return record;
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

async function decide(deps: ChatPlaceDeps, target: Target, request: string) {
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
  });
  return { decision, branches, clean };
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
  const { decision, branches, clean } = await decide(deps, target, input.userRequest);
  if (decision.kind === 'checkout') return { input, repoRoot: target.root, note: decision.note };
  if (decision.kind === 'in_place') {
    const record = await inPlace(deps, target, decision.branch);
    return { input, repoRoot: target.root, note: placeNote(record, null) };
  }
  const planned = await plannedSource(deps, target, input.userRequest, branches, decision);
  if (!planned) return { input, repoRoot: target.root, note: null };
  const record = await createCopy(deps, target, planned);
  const extra = decision.kind === 'new' ? decision.note : null;
  const fromHead = decision.kind === 'new' && decision.from === null;
  const dirty = fromHead && !clean ? DIRTY_NOTE : null;
  const note = placeNote(record, [extra, dirty].filter(Boolean).join(' ') || null);
  return { input: inCopy(input, record), repoRoot: target.root, note };
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

export async function placeChatOrStop(
  deps: { db: Queryable; branchPrefix?: string },
  input: RunInput,
  append: Append,
  create: boolean,
): Promise<PlacedChat | null> {
  try {
    const placed = await placeChat(
      { db: deps.db, branchPrefix: deps.branchPrefix ?? DEFAULT_BRANCH_PREFIX },
      input,
      create,
    );
    if (placed.note) await planNote(append, placed.note);
    return placed;
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
    const message = `${WORKTREE_FAILED} ${reason}`;
    await append(runEvents.error(message, 'orchestration_failed'), {
      transition: { status: 'failed', error: message },
    });
    return null;
  }
}

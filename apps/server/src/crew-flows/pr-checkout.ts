import { execFile } from 'node:child_process';
import { access, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Queryable } from '../persistence/db.ts';
import { checkedOut } from '../pr-tracking/chat-repos.ts';
import { originOf } from '../projects/repo-scan.ts';
import { git } from '../projects/snapshot.ts';
import { prepareDependencies } from '../projects/worktree-deps.ts';
import { WORKTREES_DIR, excludeSparkDir } from '../projects/worktrees.ts';

const run = promisify(execFile);
const FETCH_TIMEOUT_MS = 60_000;
const FOLDER_PREFIX = 'pr-';
export const CHECKOUT_REF_PREFIX = 'refs/spark-outpost/pr-checkouts/';

export interface PullRef {
  id: string;
  owner: string;
  repo: string;
  number: number;
}

export type PullPlace =
  | { kind: 'none' }
  | { kind: 'unlinked'; pull: PullRef }
  | { kind: 'unfetched'; pull: PullRef }
  | { kind: 'checkout'; pull: PullRef; path: string; replaces: string; head: string };

export interface CheckoutAsk {
  db: Queryable;
  workspaceId: string;
  workflowRunId: string;
  pullId: string | null;
  roots: readonly string[];
  prepare?: (main: string, copy: string) => Promise<unknown>;
}

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PULL_ID = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;

export function parsePullId(id: string | null): PullRef | null {
  const found = id ? PULL_ID.exec(id) : null;
  if (!found) return null;
  return { id: id!, owner: found[1]!, repo: found[2]!, number: Number(found[3]) };
}

async function maybe<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}

const sameRepo = (slug: string | null, pull: PullRef) =>
  slug !== null && slug.toLowerCase() === `${pull.owner}/${pull.repo}`.toLowerCase();

async function linkedRoot(roots: readonly string[], pull: PullRef): Promise<string | null> {
  for (const root of roots) {
    if (sameRepo(await maybe(() => originOf(root)), pull)) return root;
  }
  return null;
}

async function commitOf(root: string, ref: string): Promise<string | null> {
  const sha = await maybe(() => git(root, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]));
  return sha?.trim() || null;
}

async function watchedBranch(ask: CheckoutAsk, pull: PullRef): Promise<string | null> {
  const { rows } = await ask.db.query<{ branch: string }>(
    `SELECT branch FROM pr_watches
     WHERE workspace_id = $1 AND lower(owner) = lower($2) AND lower(repo) = lower($3)
       AND number = $4
     ORDER BY updated_at DESC LIMIT 1`,
    [ask.workspaceId, pull.owner, pull.repo, pull.number],
  );
  return rows[0]?.branch ?? null;
}

export const checkoutRef = (workflowRunId: string) => `${CHECKOUT_REF_PREFIX}${workflowRunId}`;

async function fetchHead(root: string, pull: PullRef, ref: string): Promise<string | null> {
  const fetched = await maybe(() =>
    run(
      'git',
      [
        '-C',
        root,
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-write-fetch-head',
        'origin',
        `+refs/pull/${pull.number}/head:${ref}`,
      ],
      { timeout: FETCH_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    ),
  );
  return fetched ? commitOf(root, ref) : null;
}

async function mainWorktree(root: string): Promise<string> {
  const listed = await git(root, ['worktree', 'list', '--porcelain']);
  const first = listed.split('\n').find((line) => line.startsWith('worktree '));
  if (!first) throw new Error('No main worktree.');
  return first.slice('worktree '.length);
}

export function checkoutFolder(main: string, workflowRunId: string): string {
  return path.join(main, WORKTREES_DIR, `${FOLDER_PREFIX}${workflowRunId}`);
}

interface Recorded {
  checkout_path: string | null;
  checkout_root: string | null;
  checkout_main: string | null;
}

async function recorded(db: Queryable, workflowRunId: string): Promise<Recorded | null> {
  const { rows } = await db.query<Recorded>(
    'SELECT checkout_path, checkout_root, checkout_main FROM workflow_runs WHERE id = $1',
    [workflowRunId],
  );
  return rows[0] ?? null;
}

async function reuse(ask: CheckoutAsk, pull: PullRef): Promise<PullPlace | null> {
  const row = await recorded(ask.db, ask.workflowRunId);
  if (!row?.checkout_path || !row.checkout_root) return null;
  const head = await commitOf(row.checkout_path, 'HEAD');
  if (!head) return null;
  return { kind: 'checkout', pull, path: row.checkout_path, replaces: row.checkout_root, head };
}

async function record(ask: CheckoutAsk, folder: string, root: string, main: string) {
  await ask.db.query(
    `UPDATE workflow_runs SET checkout_path = $2, checkout_root = $3, checkout_main = $4
     WHERE id = $1`,
    [ask.workflowRunId, folder, root, main],
  );
}

async function onSameCode(ask: CheckoutAsk, root: string, pull: PullRef, head: string) {
  const branch = await maybe(() => checkedOut(root));
  const watched = await maybe(() => watchedBranch(ask, pull));
  if (branch && watched) return false;
  return (await commitOf(root, 'HEAD')) === head;
}

async function makeCheckout(ask: CheckoutAsk, root: string, pull: PullRef): Promise<PullPlace> {
  const branch = await maybe(() => checkedOut(root));
  const watched = await maybe(() => watchedBranch(ask, pull));
  if (branch && watched && branch === watched) return { kind: 'none' };
  const main = await mainWorktree(root);
  const folder = checkoutFolder(main, ask.workflowRunId);
  await record(ask, folder, root, main);
  const head = await fetchHead(main, pull, checkoutRef(ask.workflowRunId));
  if (!head) {
    await removeRunCheckout(ask.db, ask.workflowRunId);
    return { kind: 'unfetched', pull };
  }
  if (await onSameCode(ask, root, pull, head)) {
    await removeRunCheckout(ask.db, ask.workflowRunId);
    return { kind: 'none' };
  }
  await maybe(() => excludeSparkDir(main));
  await rm(folder, { recursive: true, force: true });
  await git(main, [
    'worktree',
    'add',
    '--quiet',
    '--detach',
    folder,
    checkoutRef(ask.workflowRunId),
  ]);
  const prepare = ask.prepare ?? ((from, copy) => prepareDependencies(from, copy, { root: from }));
  await maybe(() => prepare(root, folder));
  return { kind: 'checkout', pull, path: folder, replaces: root, head };
}

export async function placeRunPull(ask: CheckoutAsk): Promise<PullPlace> {
  const pull = parsePullId(ask.pullId);
  if (!pull) return { kind: 'none' };
  const root = await linkedRoot(ask.roots, pull);
  if (!root) return { kind: 'unlinked', pull };
  const kept = await reuse(ask, pull);
  if (kept) return kept;
  try {
    return await makeCheckout(ask, root, pull);
  } catch (error) {
    console.error(`Could not check out ${pull.id} for workflow run ${ask.workflowRunId}`, error);
    await removeRunCheckout(ask.db, ask.workflowRunId);
    return { kind: 'unfetched', pull };
  }
}

function changedPaths(status: string): string[] {
  const entries = status.split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    paths.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') index += 1;
  }
  return paths.sort((a, b) => a.localeCompare(b));
}

export async function checkoutChanges(folder: string): Promise<string[]> {
  const status = await maybe(() =>
    git(folder, ['status', '--porcelain', '-z', '--untracked-files=all']),
  );
  return status ? changedPaths(status) : [];
}

async function removeFolder(main: string, folder: string, workflowRunId: string) {
  await maybe(() => git(main, ['worktree', 'remove', '--force', folder]));
  await rm(folder, { recursive: true, force: true });
  await maybe(() => git(main, ['worktree', 'prune']));
  await maybe(() => git(main, ['update-ref', '-d', checkoutRef(workflowRunId)]));
}

export async function removeRunCheckout(db: Queryable, workflowRunId: string): Promise<void> {
  const row = await recorded(db, workflowRunId);
  if (row?.checkout_path && row.checkout_main) {
    await removeFolder(row.checkout_main, row.checkout_path, workflowRunId);
  }
  await db.query(
    `UPDATE workflow_runs SET checkout_path = NULL, checkout_root = NULL, checkout_main = NULL
     WHERE id = $1`,
    [workflowRunId],
  );
}

export async function sweepRecordedCheckouts(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM workflow_runs WHERE checkout_path IS NOT NULL AND status <> 'running'`,
  );
  for (const { id } of rows) await removeRunCheckout(db, id);
  return rows.length;
}

async function runningCheckouts(db: Queryable): Promise<Set<string>> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM workflow_runs WHERE status = 'running' AND checkout_path IS NOT NULL`,
  );
  return new Set(rows.map((row) => row.id));
}

async function projectMains(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ root_path: string }>('SELECT root_path FROM projects');
  const mains = await Promise.all(rows.map((row) => maybe(() => mainWorktree(row.root_path))));
  return [...new Set(mains.filter((main): main is string => main !== null))];
}

async function leftRefs(main: string): Promise<string[]> {
  const listed = await maybe(() =>
    git(main, ['for-each-ref', '--format=%(refname)', CHECKOUT_REF_PREFIX]),
  );
  return (listed ?? '')
    .split('\n')
    .filter(Boolean)
    .map((ref) => ref.slice(CHECKOUT_REF_PREFIX.length))
    .filter((id) => UUID.test(id));
}

async function leftFolders(main: string): Promise<string[]> {
  const entries = await readdir(path.join(main, WORKTREES_DIR)).catch(() => []);
  return entries
    .filter((name) => name.startsWith(FOLDER_PREFIX))
    .map((name) => name.slice(FOLDER_PREFIX.length))
    .filter((id) => UUID.test(id));
}

export async function sweepUnclaimedCheckouts(db: Queryable): Promise<number> {
  let removed = 0;
  for (const main of await projectMains(db)) {
    const ids = new Set([...(await leftFolders(main)), ...(await leftRefs(main))]);
    if (ids.size === 0) continue;
    const claimed = await runningCheckouts(db);
    for (const id of ids) {
      if (claimed.has(id)) continue;
      const folder = checkoutFolder(main, id);
      if ((await exists(folder)) || (await commitOf(main, checkoutRef(id)))) {
        await removeFolder(main, folder, id);
        removed += 1;
      }
    }
  }
  return removed;
}

const FOLDER_SWEEP_EVERY_MS = 60 * 60 * 1000;
let foldersSweptAt = 0;

export async function sweepRunCheckouts(db: Queryable, now = Date.now()): Promise<number> {
  const recorded = await sweepRecordedCheckouts(db);
  if (now - foldersSweptAt < FOLDER_SWEEP_EVERY_MS) return recorded;
  foldersSweptAt = now;
  return recorded + (await sweepUnclaimedCheckouts(db));
}

const shortSha = (sha: string) => sha.slice(0, 12);

export function checkoutStepLine(place: PullPlace): string | null {
  if (place.kind === 'checkout') {
    return `You are working in a temporary checkout of pull request ${place.pull.id} at its head (${shortSha(place.head)}, a detached HEAD with no branch), not in this chat’s own folder or branch. Spark deletes it when the run ends, so nothing you change there is kept.`;
  }
  if (place.kind === 'unlinked') {
    return `This run is about pull request ${place.pull.id}, which is not in a repository linked to this chat, so it is not checked out: read it from GitHub.`;
  }
  if (place.kind === 'unfetched') {
    return `This run is about pull request ${place.pull.id}, but Spark could not fetch it, so you are on this chat’s own branch: read the pull request from GitHub.`;
  }
  return null;
}

export function checkoutNote(place: PullPlace, changed: readonly string[]): string | null {
  if (place.kind === 'unlinked') {
    return `Pull request ${place.pull.id} is not in a repository linked to this chat, so the steps read it from GitHub instead of a checkout.`;
  }
  if (place.kind === 'unfetched') {
    return `Spark could not fetch pull request ${place.pull.id}, so the steps worked on this chat’s own branch and read the pull request from GitHub.`;
  }
  if (place.kind !== 'checkout') return null;
  const ran = `The steps ran on a temporary checkout of pull request ${place.pull.id} at its head (${shortSha(place.head)}), not on this chat’s branch; Spark removed it when the run ended.`;
  if (changed.length === 0) return ran;
  const shown = changed.slice(0, 20).join(', ');
  const more = changed.length > 20 ? ` and ${changed.length - 20} more` : '';
  return `${ran} The steps changed ${changed.length} file${changed.length === 1 ? '' : 's'} there (${shown}${more}); nothing was committed, so those changes were discarded with the checkout.`;
}

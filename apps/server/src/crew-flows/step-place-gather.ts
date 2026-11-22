import path from 'node:path';
import { hasProject } from '../orchestration/spark-child.ts';
import { chatWorktreeAt, type ChatWorktree } from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import { checkedOut } from '../pr-tracking/chat-repos.ts';
import { parseNumstatZ } from '../projects/change-list.ts';
import { defaultBranch } from '../projects/chat-worktrees.ts';
import { originOf } from '../projects/repo-scan.ts';
import { git, isGitWorkTree } from '../projects/snapshot.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { pullNamedIn, type TurnWorkflowRun } from './run-records.ts';
import { landedCommits } from './step-place-landed.ts';
import {
  isScheduled,
  startedBy,
  stepPlaceBlock,
  type PlaceFile,
  type RunPull,
  type StepPlace,
} from './step-place.ts';

async function maybe<T>(work: () => Promise<T | null>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

async function firstRef(root: string, candidates: readonly (string | null)[]) {
  for (const ref of candidates) {
    if (!ref) continue;
    const found = await maybe(() => git(root, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]));
    if (found?.trim()) return ref;
  }
  return null;
}

async function forkPoint(root: string, ref: string | null, record: ChatWorktree | null) {
  if (ref) {
    const base = await maybe(() => git(root, ['merge-base', ref, 'HEAD']));
    if (base?.trim()) return base.trim();
  }
  return record?.baseCommit ?? null;
}

async function changedFiles(root: string, from: string | null): Promise<PlaceFile[]> {
  const diff = await git(root, ['diff', '--numstat', '--no-renames', '-z', from ?? 'HEAD']);
  const tracked = [...parseNumstatZ(diff)].map(([file, counts]) => ({
    path: file,
    ...counts,
    untracked: false,
  }));
  const others = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  const untracked = others
    .split('\0')
    .filter(Boolean)
    .map((file) => ({ path: file, added: null, removed: null, untracked: true }));
  return [...tracked, ...untracked].sort((a, b) => a.path.localeCompare(b.path));
}

async function openPull(db: Queryable, run: TurnWorkflowRun, branch: string | null) {
  if (!branch || !run.run.conversationId) return null;
  const { rows } = await db.query<{ id: string; number: number; title: string | null }>(
    `SELECT owner || '/' || repo || '#' || number AS id, number, title FROM pr_watches
     WHERE conversation_id = $1 AND branch = $2 AND pr_state = 'open'
     ORDER BY created_at DESC LIMIT 1`,
    [run.run.conversationId, branch],
  );
  return rows[0] ?? null;
}

export async function runPull(db: Queryable, turn: TurnWorkflowRun): Promise<RunPull | null> {
  const id = turn.run.pull;
  if (!id) return null;
  if (pullNamedIn(turn.message) === id) return { id, named: true, openInChat: 0 };
  const { rows } = await db.query<{ open: number }>(
    `SELECT count(*)::int AS open FROM pr_watches
     WHERE conversation_id = $1 AND pr_state = 'open'`,
    [turn.run.conversationId],
  );
  return { id, named: false, openInChat: rows[0]?.open ?? 0 };
}

interface PlaceAsk {
  db: Queryable;
  input: RunInput;
  turn: TurnWorkflowRun;
}

async function gitPlace(ask: PlaceAsk, root: string, base: Omit<StepPlace, 'project'>) {
  const record = await maybe(() => chatWorktreeAt(ask.db, root));
  const repo = await maybe(() => originOf(root));
  const project = repo ?? path.basename(record?.repoRoot ?? root);
  const branch = await maybe(() => checkedOut(root));
  const baseName = record?.baseBranch ?? (await maybe(() => defaultBranch(root)));
  const ref = await firstRef(root, [
    record?.baseRef ?? null,
    baseName ? `refs/remotes/origin/${baseName}` : null,
    baseName ? `refs/heads/${baseName}` : null,
  ]);
  const from = await forkPoint(root, ref, record);
  return {
    ...base,
    project,
    branch,
    base: baseName,
    filesBase: from ? baseName : null,
    files: await maybe(() => changedFiles(root, from)),
    pull: await maybe(() => openPull(ask.db, ask.turn, branch)),
    target: await maybe(() => runPull(ask.db, ask.turn)),
    landed: base.scheduled
      ? await maybe(() =>
          landedCommits({
            db: ask.db,
            workspaceId: ask.input.workspaceId,
            turn: ask.turn,
            root,
            base: baseName,
          }),
        )
      : null,
  };
}

async function gatherStepPlace(ask: PlaceAsk): Promise<StepPlace | null> {
  const { input, turn } = ask;
  if (turn.run.kind === 'review' || !hasProject(input)) return null;
  const root = input.projectRoots[0]!;
  const base = {
    startedBy: startedBy(turn.run.kind, turn.run.source, turn.triggerKind),
    testRun: turn.run.kind === 'test',
    scheduled: isScheduled(turn.run.source),
    branch: null,
    base: null,
    filesBase: null,
    files: null,
    pull: null,
    target: null,
    landed: null,
  };
  if (!(await isGitWorkTree(root))) return { ...base, project: path.basename(root) };
  return gitPlace(ask, root, base);
}

export async function stepPlaceFor(ask: PlaceAsk): Promise<string | null> {
  return stepPlaceBlock(await maybe(() => gatherStepPlace(ask)));
}

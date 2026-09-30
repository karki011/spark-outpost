import path from 'node:path';
import type { TaskPiece } from '@spark-outpost/contracts';
import {
  getWorktree,
  markMerged,
  saveBase,
  saveResult,
  unmergedPieceCopy,
} from '../persistence/worktrees.ts';
import { awaitDepsPrep } from '../projects/deps-prep.ts';
import { commitTree } from '../projects/snapshot.ts';
import {
  commitWorktree,
  excludeSparkDir,
  groupBase,
  repoTop,
  worktreePath,
} from '../projects/worktrees.ts';
import { ensureParentSnapshot } from '../orchestration/members.ts';
import type { MemberResult, Session } from '../orchestration/session.ts';
import { copyFor, removeCopy } from '../orchestration/solo-copy.ts';
import { mergeIntoMain } from './merge.ts';
import { renumberCopy } from './migrations.ts';
import { mergeMainInto } from './merge-main.ts';
import { changedFiles, type PieceSite } from './piece-run.ts';
import { projectFiles } from './project-facts.ts';
import type { Coordination } from './state.ts';

interface CopyState {
  piece: TaskPiece;
  name: string;
  base: string;
  runId: string | null;
  branch: string | null;
  landed: boolean;
  mainMoved: boolean;
}

export interface Copies {
  root: string;
  top: string;
  queue: Promise<unknown>;
  states: Map<string, CopyState>;
}

export async function openCopies(s: Session): Promise<Copies> {
  const root = s.input.projectRoots[0]!;
  await ensureParentSnapshot(s);
  await excludeSparkDir(root);
  return { root, top: await repoTop(root), queue: Promise.resolve(), states: new Map() };
}

function serial<T>(copies: Copies, work: () => Promise<T>): Promise<T> {
  const next = copies.queue.then(work, work);
  copies.queue = next.catch(() => undefined);
  return next;
}

function projectPath(copies: Copies, runId: string): string {
  return path.join(worktreePath(copies.root, runId), path.relative(copies.top, copies.root));
}

async function mergeMain(s: Session, copies: Copies, state: CopyState): Promise<string | null> {
  if (!state.runId || !state.mainMoved) return null;
  state.mainMoved = false;
  const merged = await mergeMainInto(projectPath(copies, state.runId), copies.root, state.base);
  if (!merged.merged || !merged.main) return null;
  state.base = merged.main;
  await saveBase(s.deps.db, state.runId, merged.main);
  return commitTree(copies.root, merged.main);
}

async function land(
  s: Session,
  coordination: Coordination,
  copies: Copies,
  state: CopyState,
  result: MemberResult,
): Promise<string | null> {
  const record = state.runId ? await getWorktree(s.deps.db, state.runId) : null;
  if (!record) return null;
  const target = worktreePath(copies.root, record.runId);
  const renamed = await renumberCopy(record.path, state.base, await projectFiles(copies.root));
  coordination.renumbered = [
    ...(coordination.renumbered ?? []),
    ...renamed.map((rename) => ({ piece: state.piece.key, ...rename })),
  ];
  const commit = await commitWorktree(copies.root, target, record.branch, state.base, record.runId);
  await saveResult(s.deps.db, record.runId, commit);
  const unlanded = await mergeIntoMain(s, coordination, {
    root: copies.root,
    base: state.base,
    result: commit,
    runId: record.runId,
    name: result.name,
    piece: state.piece,
  });
  if (unlanded !== null) return unlanded;
  await markMerged(s.deps.db, record.runId);
  state.landed = true;
  for (const other of copies.states.values()) {
    if (!other.landed) other.mainMoved = true;
  }
  return null;
}

export async function copySite(
  s: Session,
  coordination: Coordination,
  copies: Copies,
  piece: TaskPiece,
  slot: number,
): Promise<PieceSite> {
  const name = coordination.names.get(piece.key) ?? piece.key;
  const kept = await unmergedPieceCopy(s.deps.db, s.lease.runId, piece.key);
  const base =
    kept?.baseCommit ??
    (await serial(copies, () => groupBase(copies.root, `${s.lease.runId} ${piece.key}`)));
  const state: CopyState = {
    piece,
    name,
    base,
    runId: kept?.runId ?? null,
    branch: kept?.branch ?? null,
    landed: false,
    mainMoved: false,
  };
  copies.states.set(piece.key, state);
  const make = copyFor(s, { root: copies.root, top: copies.top, base });
  return {
    copy: name,
    slot,
    cwd: async () => {
      if (!state.runId) return copies.root;
      await awaitDepsPrep(s.deps.db, state.runId);
      return projectPath(copies, state.runId);
    },
    place: async () => {
      if (state.runId && state.branch) {
        return { reuse: { runId: state.runId, branch: state.branch } };
      }
      return {
        copy: (member) => {
          const copy = make(member);
          return {
            branch: copy.branch,
            prepare: async (runId) => {
              await copy.prepare(runId);
              state.runId = runId;
              state.branch = copy.branch;
            },
          };
        },
      };
    },
    before: () => commitTree(copies.root, state.base),
    changed: async (before) =>
      state.runId ? changedFiles(projectPath(copies, state.runId), before) : [],
    boundary: () => serial(copies, () => mergeMain(s, copies, state)),
    land: (result) => serial(copies, () => land(s, coordination, copies, state, result)),
  };
}

export async function dropCopy(s: Session, copies: Copies, key: string): Promise<void> {
  const runId = copies.states.get(key)?.runId;
  const record = runId ? await getWorktree(s.deps.db, runId) : null;
  if (record && !record.removedAt) await removeCopy(s.deps.db, record);
}

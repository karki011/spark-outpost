import type { TaskPiece } from '@spark-outpost/contracts';
import { saveSnapshot } from '../persistence/run-snapshots.ts';
import { attributeFiles, runSnapshots } from '../projects/shared-tree.ts';
import { commitWorkingTree, gitChanges } from '../projects/snapshot.ts';
import { groupBase, pinSnapshot } from '../projects/worktrees.ts';
import { ensureParentSnapshot } from '../orchestration/members.ts';
import type { Session } from '../orchestration/session.ts';
import { owns, type OwnedSet } from './owned.ts';
import { changedFiles, type PieceSite } from './piece-run.ts';
import type { Coordination, SharedBase } from './state.ts';

function ownedSet(coordination: Coordination, key: string): OwnedSet {
  return coordination.owned.get(key) ?? { paths: [], globs: [] };
}

export async function sharedBase(s: Session, coordination: Coordination): Promise<SharedBase> {
  if (coordination.sharedBase) return coordination.sharedBase;
  const root = s.input.projectRoots[0]!;
  await ensureParentSnapshot(s);
  const base = { root, commit: await groupBase(root, `${s.lease.runId} pieces`) };
  coordination.sharedBase = base;
  return base;
}

export function sharedSite(
  coordination: Coordination,
  root: string,
  piece: TaskPiece,
  slot: number,
): PieceSite {
  const others = (coordination.list?.pieces ?? []).filter(
    (other) => other.key !== piece.key && !other.research,
  );
  const ownedByOther = (file: string) =>
    others.some((other) => owns(ownedSet(coordination, other.key), file));
  const ownedHere = (file: string) => owns(ownedSet(coordination, piece.key), file);
  return {
    cwd: async () => root,
    place: async () => null,
    slot,
    changed: async (before) =>
      (await changedFiles(root, before)).filter((file) => ownedHere(file) || !ownedByOther(file)),
  };
}

async function pieceRuns(s: Session): Promise<string[]> {
  const { rows } = await s.deps.db.query<{ id: string }>(
    `SELECT id FROM runs WHERE parent_run_id = $1 AND mode = 'do' AND route ? 'pieceKey'
     ORDER BY created_at, id`,
    [s.lease.runId],
  );
  return rows.map((row) => row.id);
}

function landedOrder(pieces: readonly TaskPiece[]): TaskPiece[] {
  return pieces
    .filter((piece) => piece.status === 'landed' && piece.builderRunId !== null)
    .sort((a, b) => (a.landedAt ?? '').localeCompare(b.landedAt ?? ''));
}

export async function attributeShared(s: Session, coordination: Coordination): Promise<void> {
  const base = coordination.sharedBase;
  const building = (coordination.list?.pieces ?? []).filter((piece) => !piece.research);
  if (!base || building.length === 0) return;
  const source = await commitWorkingTree(base.root, [base.commit], 'Spark Outpost: shared pieces');
  const changed = (await gitChanges(base.root, base.commit, source)).map((change) => change.path);
  const landed = landedOrder(building);
  const attribution = attributeFiles(
    changed,
    building.map((piece) => ({
      key: piece.key,
      owns: (file: string) => owns(ownedSet(coordination, piece.key), file),
    })),
    landed.at(-1)?.key ?? null,
  );
  const files = new Map(
    landed.map((piece) => [piece.builderRunId!, attribution.files.get(piece.key) ?? []]),
  );
  const started = new Map(
    landed.flatMap((piece) => {
      const tree = coordination.startTrees?.get(piece.key);
      return tree ? [[piece.builderRunId!, tree] as const] : [];
    }),
  );
  const snapshots = await runSnapshots(
    base.root,
    base.commit,
    source,
    await pieceRuns(s),
    files,
    started,
  );
  for (const snapshot of snapshots) {
    await pinSnapshot(base.root, snapshot.runId, snapshot.commit);
    await saveSnapshot(s.deps.db, snapshot.runId, {
      kind: 'git',
      ref: snapshot.commit,
      root: base.root,
    });
  }
}

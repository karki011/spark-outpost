import type { PieceList, PieceViolation } from '@spark-outpost/contracts';
import { insertFinishedRunEntries } from '../persistence/audit-log.ts';
import type { Db } from '../persistence/db.ts';
import { insertRailFlag } from '../persistence/rail-flags.ts';
import { git } from '../projects/snapshot.ts';
import { routeNotice } from './follow-up.ts';
import { crossedText } from './needs.ts';

export const PIECE_CROSSED_METHOD = 'spark/rail_crossed';

export interface Crossing {
  runId: string;
  worker: string;
  workerLabel: string;
  pieceKey: string;
  cwd: string;
  before: string;
  after: string | null;
}

export function attributableOwner(list: PieceList, since: string): (ownerKey: string) => boolean {
  return (ownerKey) => {
    const owner = list.pieces.find((piece) => piece.key === ownerKey);
    if (!owner) return false;
    if (owner.status === 'pending' || owner.status === 'ready') return true;
    return owner.status === 'landed' && owner.landedAt !== null && owner.landedAt < since;
  };
}

async function flag(db: Db, crossing: Crossing, paths: string[]): Promise<void> {
  const saved = await insertRailFlag(db, crossing.runId, crossing.worker, {
    toolCallId: null,
    rail: 'other_piece',
    paths,
    inside: false,
    originals: [],
  });
  if (!saved) return;
  const payload = { flagId: saved.id, rail: saved.rail, title: saved.title, paths: saved.paths };
  await insertFinishedRunEntries(db, crossing.runId, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'notification',
      method: PIECE_CROSSED_METHOD,
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: false,
      payload,
    },
  ]);
}

async function patchOf(crossing: Crossing, path: string): Promise<string> {
  if (!crossing.after) return '';
  return git(crossing.cwd, [
    'diff',
    '--relative',
    crossing.before,
    crossing.after,
    '--',
    path,
  ]).catch(() => '');
}

export async function reportCrossings(
  db: Db,
  list: PieceList,
  crossing: Crossing,
  violations: readonly PieceViolation[],
): Promise<void> {
  const paths = violations
    .filter((violation) => violation.action === 'kept')
    .map((violation) => violation.path);
  if (paths.length === 0) return;
  await flag(db, crossing, paths);
  for (const path of paths) {
    await routeNotice(db, list, {
      body: crossedText(crossing.workerLabel, path, await patchOf(crossing, path)),
      files: [path],
      source: 'coordinator',
      from: crossing.pieceKey,
    });
  }
}

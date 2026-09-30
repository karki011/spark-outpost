import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TaskPiece } from '@spark-outpost/contracts';
import { bumpContract, insertPieceNote } from '../persistence/piece-notes.ts';
import { pieceListById } from '../persistence/pieces.ts';
import { git, workingTree } from '../projects/snapshot.ts';
import type { Session } from '../orchestration/session.ts';
import { landingNotices } from './notes.ts';
import type { PieceSite } from './piece-run.ts';
import type { Coordination } from './state.ts';

const SOURCE_LIMIT = 200_000;

interface Landing {
  piece: TaskPiece;
  coordination: Coordination;
  site: PieceSite;
  before: string | null;
}

async function landedPatch(cwd: string, before: string, files: readonly string[]): Promise<string> {
  if (files.length === 0) return '';
  const after = await workingTree(cwd);
  return git(cwd, ['diff', '--no-renames', '--relative', before, after, '--', ...files]);
}

async function ownedSources(cwd: string, piece: TaskPiece): Promise<string[]> {
  const reads = piece.owns.map((file) =>
    readFile(path.join(cwd, file), 'utf8')
      .then((text) => text.slice(0, SOURCE_LIMIT))
      .catch(() => ''),
  );
  return Promise.all(reads);
}

export async function announceLanding(s: Session, landing: Landing, builder: string) {
  const listId = landing.coordination.list?.id;
  const list = listId ? await pieceListById(s.deps.db, listId) : null;
  const landed = list?.pieces.find((piece) => piece.key === landing.piece.key);
  if (!list || !landed || !landing.before) return;
  const running = list.pieces.filter(
    (piece) => piece.status === 'running' && piece.key !== landed.key && !piece.research,
  );
  if (running.length === 0) return;
  const cwd = await landing.site.cwd();
  const patch = await landedPatch(cwd, landing.before, landed.filesChanged);
  const withSources = await Promise.all(
    running.map(async (piece) => ({ piece, sources: await ownedSources(cwd, piece) })),
  );
  for (const notice of landingNotices({ piece: landed, builder, patch }, withSources)) {
    const target = running.find((piece) => piece.key === notice.pieceKey)!;
    await insertPieceNote(
      s.deps.db,
      { pieceId: target.id },
      { kind: notice.kind, body: notice.body, source: 'coordinator', urgent: notice.urgent },
    );
    if (notice.kind === 'contract_changed') await bumpContract(s.deps.db, target.id);
  }
}

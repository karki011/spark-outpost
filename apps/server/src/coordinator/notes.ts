import type { PieceNoteKind, TaskPiece } from '@spark-outpost/contracts';
import type { StoredNote } from '../persistence/piece-notes.ts';

export const NOTE_HEADING = '## Note from the coordinator';

const DELIVERED_AT_BOUNDARY: ReadonlySet<PieceNoteKind> = new Set([
  'merge_main',
  'contract_changed',
  'requirement_added',
  'steer',
]);

const KIND_LABELS: Partial<Record<PieceNoteKind, string>> = {
  merge_main: 'Main merged into your copy',
  contract_changed: 'A contract you use changed',
  requirement_added: 'Added requirement',
  steer: 'From the user',
};

export function deliverable(notes: readonly StoredNote[]): StoredNote[] {
  return notes.filter((note) => DELIVERED_AT_BOUNDARY.has(note.kind));
}

export function noteSection(notes: readonly StoredNote[]): string | null {
  const shown = deliverable(notes);
  if (shown.length === 0) return null;
  const lines = shown.map((note) => `- ${KIND_LABELS[note.kind]}: ${note.body}`);
  return `${NOTE_HEADING}\n${lines.join('\n')}\n\nAct on these before anything else, then reply with what you changed.`;
}

const CALLED = /([A-Za-z_$][\w$]*)\s*\(/g;
const QUOTED = /`([A-Za-z_$][\w$.]*)`/g;

export function contractSymbols(contract: string | null): string[] {
  if (!contract) return [];
  const names = [...contract.matchAll(CALLED), ...contract.matchAll(QUOTED)].map((match) =>
    match[1]!.split('.').at(-1)!,
  );
  return [...new Set(names)];
}

function changedLines(patch: string): string[] {
  return patch.split('\n').filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line));
}

export function touchedSymbols(symbols: readonly string[], patch: string): string[] {
  const lines = changedLines(patch);
  return symbols.filter((symbol) => {
    const word = new RegExp(`(^|[^\\w$])${symbol.replace(/\$/g, '\\$')}([^\\w$]|$)`);
    return lines.some((line) => word.test(line));
  });
}

export interface LandingNotice {
  pieceKey: string;
  kind: 'contract_changed';
  body: string;
  urgent: boolean;
}

export interface LandedChange {
  piece: Pick<TaskPiece, 'key' | 'title' | 'filesChanged' | 'contract'>;
  builder: string;
  patch: string;
}

function stem(file: string): string {
  return file.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
}

export function importsAny(sources: readonly string[], files: readonly string[]): boolean {
  const stems = files.map(stem).filter((name) => name.length > 0);
  const importLine =
    /^\s*(import|export)\b.*from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/gm;
  return sources.some((source) =>
    [...source.matchAll(importLine)].some((match) =>
      stems.includes(stem(match[2] ?? match[3] ?? '')),
    ),
  );
}

function usedFiles(
  piece: TaskPiece,
  sources: readonly string[],
  landed: LandedChange['piece'],
): string[] {
  if (piece.dependsOn.includes(landed.key)) return landed.filesChanged;
  return landed.filesChanged.filter(
    (file) => piece.reads.includes(file) || importsAny(sources, [file]),
  );
}

const FILE_HEADER = /^diff --git a\/.* b\/(.+)$/;

function patchOf(patch: string, files: readonly string[]): string {
  return patch
    .split(/^(?=diff --git )/m)
    .filter((part) => {
      const file = FILE_HEADER.exec(part.split('\n', 1)[0]!)?.[1];
      return file !== undefined && files.includes(file);
    })
    .join('');
}

export function landingNotices(
  landed: LandedChange,
  running: readonly { piece: TaskPiece; sources: readonly string[] }[],
): LandingNotice[] {
  const notices: LandingNotice[] = [];
  const name = `${landed.builder}'s ${landed.piece.title}`;
  for (const { piece, sources } of running) {
    const used = usedFiles(piece, sources, landed.piece);
    if (used.length === 0) continue;
    const symbols = [...contractSymbols(piece.contract), ...contractSymbols(landed.piece.contract)];
    const touched = touchedSymbols([...new Set(symbols)], patchOf(landed.patch, used));
    if (touched.length === 0) continue;
    notices.push({
      pieceKey: piece.key,
      kind: 'contract_changed',
      body: `${name} changed ${touched.map((symbol) => `\`${symbol}\``).join(', ')}, which your piece uses; check your code against the new version.`,
      urgent: importsAny(sources, landed.piece.filesChanged),
    });
  }
  return notices;
}

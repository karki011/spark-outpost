import { getChunks, getOriginalDoc, mergeViewSiblings, type Chunk } from '@codemirror/merge';
import type { EditorState, Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { HUNK_PAIR_LIMIT, hunkEdits, type LineEdit } from '../word-spans.ts';

export interface LineRange {
  first: number;
  count: number;
}

export interface ChunkEdits {
  before: LineRange;
  after: LineRange;
  edits: (LineEdit | null)[] | null;
}

export interface SideDocs {
  before: Text;
  after: Text;
}

const cache = new WeakMap<object, { edits: ChunkEdits['edits'] }>();

export function chunksOf(state: EditorState): readonly Chunk[] {
  return getChunks(state)?.chunks ?? [];
}

export function sideDocs(view: EditorView, initial: SideDocs | null): SideDocs {
  const siblings = mergeViewSiblings(view) as { a?: EditorView; b?: EditorView } | null;
  if (!siblings) return { before: getOriginalDoc(view.state), after: view.state.doc };
  if (siblings.a && siblings.b) {
    return { before: siblings.a.state.doc, after: siblings.b.state.doc };
  }
  return initial ?? { before: view.state.doc, after: view.state.doc };
}

export function lineRange(doc: Text, from: number, to: number): LineRange {
  if (from >= to) return { first: doc.lineAt(Math.min(from, doc.length)).number, count: 0 };
  const first = doc.lineAt(from).number;
  return { first, count: doc.lineAt(Math.min(doc.length, to - 1)).number - first + 1 };
}

function lines(doc: Text, range: LineRange, count: number): string[] {
  return Array.from({ length: count }, (_, index) => doc.line(range.first + index).text);
}

function pairedEdits(docs: SideDocs, before: LineRange, after: LineRange): ChunkEdits['edits'] {
  const pairs = Math.min(before.count, after.count);
  if (pairs === 0 || pairs > HUNK_PAIR_LIMIT) return null;
  return hunkEdits(lines(docs.before, before, pairs), lines(docs.after, after, pairs));
}

export function chunkEdits(chunk: Chunk, docs: SideDocs): ChunkEdits {
  const before = lineRange(docs.before, chunk.fromA, chunk.toA);
  const after = lineRange(docs.after, chunk.fromB, chunk.toB);
  let known = cache.get(chunk.changes);
  if (!known) {
    known = { edits: pairedEdits(docs, before, after) };
    cache.set(chunk.changes, known);
  }
  return { before, after, edits: known.edits };
}

export function chunkBefore(chunks: readonly Chunk[], pos: number): Chunk | null {
  let low = 0;
  let high = chunks.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (chunks[middle]!.fromB <= pos) low = middle + 1;
    else high = middle;
  }
  return chunks[low - 1] ?? null;
}

export function removedChunkAt(chunks: readonly Chunk[], pos: number): Chunk | null {
  const chunk = chunkBefore(chunks, pos);
  return chunk && chunk.fromB === pos && chunk.fromA < chunk.toA ? chunk : null;
}

import { getChunks } from '@codemirror/merge';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import {
  chunkEdits,
  chunksOf,
  removedChunkAt,
  sideDocs,
  type ChunkEdits,
  type SideDocs,
} from './chunk-edits.ts';
import { markRemovedWords, rowHeights } from './removed-lines.ts';

const wordMark = Decoration.mark({ class: 'dd-word' });

function wordDecorations(view: EditorView, docs: SideDocs): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const before = getChunks(view.state)?.side === 'a';
  const { doc } = view.state;
  const { from, to } = view.viewport;
  for (const chunk of chunksOf(view.state)) {
    const start = before ? chunk.fromA : chunk.fromB;
    const end = before ? chunk.toA : chunk.toB;
    if (start >= to) break;
    if (end <= from) continue;
    const found = chunkEdits(chunk, docs);
    const range = before ? found.before : found.after;
    found.edits?.forEach((edit, index) => {
      if (!edit) return;
      const line = doc.line(range.first + index);
      for (const span of before ? edit.before : edit.after) {
        builder.add(line.from + span.from, line.from + span.to, wordMark);
      }
    });
  }
  return builder.finish();
}

interface RemovedChunk {
  element: HTMLElement;
  found: ChunkEdits;
  rows: HTMLElement | null;
  width: string;
  heights: number[] | null;
}

function numberRows(view: EditorView, first: number): HTMLElement | null {
  return view.dom.querySelector<HTMLElement>(`.dd-old-rows[data-first="${first}"]`);
}

function readRemoved(view: EditorView): RemovedChunk[] {
  const docs = sideDocs(view, null);
  const chunks = chunksOf(view.state);
  const removed: RemovedChunk[] = [];
  for (const element of view.contentDOM.querySelectorAll<HTMLElement>('.cm-deletedChunk')) {
    const chunk = removedChunkAt(chunks, view.posAtDOM(element));
    if (!chunk) continue;
    const found = chunkEdits(chunk, docs);
    const rows = numberRows(view, found.before.first);
    const width = String(element.clientWidth);
    const stale = rows !== null && view.lineWrapping && rows.dataset.width !== width;
    removed.push({ element, found, rows, width, heights: stale ? rowHeights(element) : null });
  }
  return removed;
}

function setRowHeights(rows: HTMLElement, heights: readonly number[] | null): void {
  Array.from(rows.children).forEach((row, index) => {
    if (row instanceof HTMLElement) row.style.height = heights ? `${heights[index] ?? 0}px` : '';
  });
}

function writeRemoved(removed: RemovedChunk[], view: EditorView): void {
  for (const { element, found, rows, width, heights } of removed) {
    if (element.dataset.words === undefined) {
      element.dataset.words = '';
      if (found.edits) markRemovedWords(element, found.edits);
    }
    if (!rows) continue;
    if (heights) {
      rows.dataset.width = width;
      setRowHeights(rows, heights);
    } else if (!view.lineWrapping && rows.dataset.width !== undefined) {
      delete rows.dataset.width;
      setRowHeights(rows, null);
    }
  }
}

const removedMeasure = { key: 'dd-removed-lines', read: readRemoved, write: writeRemoved };

export function wordMarks(initial: SideDocs | null): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = wordDecorations(view, sideDocs(view, initial));
        view.requestMeasure(removedMeasure);
      }

      update(update: ViewUpdate) {
        const { view } = update;
        const chunksChanged = chunksOf(update.startState) !== chunksOf(update.state);
        if (update.docChanged || update.viewportChanged || chunksChanged) {
          this.decorations = wordDecorations(view, sideDocs(view, initial));
        }
        if (chunksChanged || update.viewportChanged || update.geometryChanged) {
          view.requestMeasure(removedMeasure);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

import { getOriginalDoc } from '@codemirror/merge';
import type { EditorState, Extension } from '@codemirror/state';
import { BlockType, GutterMarker, gutter, type BlockInfo, type EditorView } from '@codemirror/view';
import { chunkBefore, chunksOf, lineRange, removedChunkAt, type LineRange } from './chunk-edits.ts';

class NumberMarker extends GutterMarker {
  constructor(readonly value: number) {
    super();
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof NumberMarker && other.value === this.value;
  }

  override toDOM(): Node {
    return document.createTextNode(String(this.value));
  }
}

class RemovedNumbers extends GutterMarker {
  constructor(readonly lines: LineRange) {
    super();
  }

  override eq(other: GutterMarker): boolean {
    return (
      other instanceof RemovedNumbers &&
      other.lines.first === this.lines.first &&
      other.lines.count === this.lines.count
    );
  }

  override toDOM(): Node {
    const rows = document.createElement('div');
    rows.className = 'dd-old-rows';
    rows.dataset.first = String(this.lines.first);
    for (let index = 0; index < this.lines.count; index++) {
      rows.append(document.createElement('div'));
      rows.lastElementChild!.textContent = String(this.lines.first + index);
    }
    return rows;
  }
}

function oldLineNumber(state: EditorState, pos: number): number | null {
  const original = getOriginalDoc(state);
  const chunk = chunkBefore(chunksOf(state), pos);
  if (!chunk) return original.lineAt(Math.min(pos, original.length)).number;
  if (pos < chunk.toB) return null;
  return original.lineAt(Math.min(pos - chunk.toB + chunk.toA, original.length)).number;
}

function removedRange(state: EditorState, pos: number): LineRange | null {
  const chunk = removedChunkAt(chunksOf(state), pos);
  if (!chunk) return null;
  return lineRange(getOriginalDoc(state), chunk.fromA, chunk.toA);
}

function removedNumbers(view: EditorView, block: BlockInfo): GutterMarker | null {
  if (block.type !== BlockType.WidgetBefore) return null;
  const range = removedRange(view.state, block.from);
  return range && new RemovedNumbers(range);
}

function widest(view: EditorView): GutterMarker {
  return new NumberMarker(getOriginalDoc(view.state).lines);
}

export function oldLineNumbers(): Extension {
  return gutter({
    class: 'dd-old-numbers',
    lineMarker: (view, line) => {
      const value = oldLineNumber(view.state, line.from);
      return value === null ? null : new NumberMarker(value);
    },
    widgetMarker: (view, _widget, block) => removedNumbers(view, block),
    lineMarkerChange: (update) => chunksOf(update.startState) !== chunksOf(update.state),
    initialSpacer: widest,
    updateSpacer: (_spacer, update) => widest(update.view),
  });
}

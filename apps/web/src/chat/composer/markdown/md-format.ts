import { codeSpan } from './backticks.ts';

export interface Edit {
  start: number;
  end: number;
  insert: string;
  selectStart: number;
  selectEnd: number;
}

export type InlineFormat = 'bold' | 'italic' | 'code' | 'strike';

type MarkedFormat = Exclude<InlineFormat, 'code'>;

const MARKERS: Record<MarkedFormat, readonly string[]> = {
  bold: ['**', '__'],
  italic: ['_', '*'],
  strike: ['~~'],
};

function runBefore(text: string, at: number, char: string): number {
  let run = 0;
  while (text[at - 1 - run] === char) run += 1;
  return run;
}

function runAfter(text: string, at: number, char: string): number {
  let run = 0;
  while (text[at + run] === char) run += 1;
  return run;
}

function wrappedBy(format: MarkedFormat, marker: string, before: number, after: number): boolean {
  if (before !== after) return false;
  if (format === 'italic') return before % 2 === 1;
  if (format === 'bold') return before >= 2;
  return before === marker.length;
}

function outsideMarker(text: string, start: number, end: number, format: MarkedFormat) {
  return MARKERS[format].find((marker) => {
    const char = marker[0]!;
    return wrappedBy(format, marker, runBefore(text, start, char), runAfter(text, end, char));
  });
}

function insideMarker(selected: string, format: MarkedFormat) {
  return MARKERS[format].find((marker) => {
    const char = marker[0]!;
    const before = runAfter(selected, 0, char);
    const after = runBefore(selected, selected.length, char);
    return selected.length > 2 * before && wrappedBy(format, marker, before, after);
  });
}

function codeInside(selected: string): string | null {
  const before = runAfter(selected, 0, '`');
  const after = runBefore(selected, selected.length, '`');
  if (before === 0 || before !== after || selected.length <= 2 * before) return null;
  const inner = selected.slice(before, selected.length - after);
  if ((inner.match(/`+/g) ?? []).some((run) => run.length === before)) return null;
  const padded = inner.length > 2 && inner.startsWith(' ') && inner.endsWith(' ');
  return padded ? inner.slice(1, -1) : inner;
}

function codeAround(
  text: string,
  start: number,
  end: number,
): { open: number; close: number } | null {
  for (const pad of [0, 1]) {
    if (pad === 1 && !(text[start - 1] === ' ' && text[end] === ' ')) continue;
    const before = runBefore(text, start - pad, '`');
    const after = runAfter(text, end + pad, '`');
    if (before > 0 && before === after)
      return { open: start - pad - before, close: end + pad + after };
  }
  return null;
}

function wrapCore(core: string, format: InlineFormat): string {
  if (format === 'code') return codeSpan(core);
  const marker = MARKERS[format][0]!;
  return `${marker}${core}${marker}`;
}

function innerOf(core: string, format: InlineFormat): string | null {
  if (format === 'code') return codeInside(core);
  const marker = insideMarker(core, format);
  return marker ? core.slice(marker.length, core.length - marker.length) : null;
}

function withCore(segment: string, change: (core: string) => string): string {
  const core = segment.trim();
  if (core === '') return segment;
  const lead = segment.length - segment.trimStart().length;
  return `${segment.slice(0, lead)}${change(core)}${segment.slice(lead + core.length)}`;
}

function unwrapped(segment: string, format: InlineFormat): string {
  return withCore(segment, (core) => innerOf(core, format) ?? core);
}

function toggleLines(text: string, start: number, end: number, format: InlineFormat): Edit {
  const lines = text.slice(start, end).split('\n');
  const filled = lines.filter((line) => line.trim() !== '');
  const allWrapped = filled.every((line) => innerOf(line.trim(), format) !== null);
  const insert = lines
    .map((line) =>
      allWrapped
        ? unwrapped(line, format)
        : withCore(unwrapped(line, format), (core) => wrapCore(core, format)),
    )
    .join('\n');
  return { start, end, insert, selectStart: start, selectEnd: start + insert.length };
}

function toggleCode(text: string, start: number, end: number): Edit {
  const selected = text.slice(start, end);
  const around = codeAround(text, start, end);
  if (around) {
    const selectStart = around.open;
    return {
      start: around.open,
      end: around.close,
      insert: selected,
      selectStart,
      selectEnd: selectStart + selected.length,
    };
  }
  const inner = codeInside(selected);
  if (inner !== null) {
    return { start, end, insert: inner, selectStart: start, selectEnd: start + inner.length };
  }
  const core = selected.trim();
  if (core === '')
    return { start: end, end, insert: '``', selectStart: end + 1, selectEnd: end + 1 };
  const span = codeSpan(core);
  const lead = selected.length - selected.trimStart().length;
  const coreStart = start + lead + span.indexOf(core);
  return {
    start,
    end,
    insert: withCore(selected, () => span),
    selectStart: coreStart,
    selectEnd: coreStart + core.length,
  };
}

export function toggleInline(text: string, start: number, end: number, format: InlineFormat): Edit {
  const selected = text.slice(start, end);
  if (selected.includes('\n')) return toggleLines(text, start, end, format);
  if (format === 'code') return toggleCode(text, start, end);
  const outside = outsideMarker(text, start, end, format);
  if (outside) {
    const size = outside.length;
    return {
      start: start - size,
      end: end + size,
      insert: selected,
      selectStart: start - size,
      selectEnd: end - size,
    };
  }
  const inside = insideMarker(selected, format);
  if (inside) {
    const insert = selected.slice(inside.length, selected.length - inside.length);
    return { start, end, insert, selectStart: start, selectEnd: start + insert.length };
  }
  const marker = MARKERS[format][0]!;
  const core = selected.trim();
  if (core === '') {
    const caret = end + marker.length;
    return { start: end, end, insert: `${marker}${marker}`, selectStart: caret, selectEnd: caret };
  }
  const lead = selected.length - selected.trimStart().length;
  const coreStart = start + lead + marker.length;
  return {
    start,
    end,
    insert: withCore(selected, (inner) => wrapCore(inner, format)),
    selectStart: coreStart,
    selectEnd: coreStart + core.length,
  };
}

export interface Edit {
  start: number;
  end: number;
  insert: string;
  selectStart: number;
  selectEnd: number;
}

export type InlineFormat = 'bold' | 'italic' | 'code' | 'strike';

const MARKERS: Record<InlineFormat, readonly string[]> = {
  bold: ['**', '__'],
  italic: ['_', '*'],
  code: ['`'],
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

function wrappedBy(format: InlineFormat, marker: string, before: number, after: number): boolean {
  if (before !== after) return false;
  if (format === 'italic') return before % 2 === 1;
  if (format === 'bold') return before >= 2;
  return before === marker.length;
}

function outsideMarker(text: string, start: number, end: number, format: InlineFormat) {
  return MARKERS[format].find((marker) => {
    const char = marker[0]!;
    return wrappedBy(format, marker, runBefore(text, start, char), runAfter(text, end, char));
  });
}

function insideMarker(selected: string, format: InlineFormat) {
  return MARKERS[format].find((marker) => {
    const char = marker[0]!;
    const before = runAfter(selected, 0, char);
    const after = runBefore(selected, selected.length, char);
    return selected.length > 2 * before && wrappedBy(format, marker, before, after);
  });
}

function wrapped(segment: string, marker: string): string {
  const core = segment.trim();
  if (core === '') return segment;
  const lead = segment.length - segment.trimStart().length;
  return `${segment.slice(0, lead)}${marker}${core}${marker}${segment.slice(lead + core.length)}`;
}

function unwrapped(segment: string, format: InlineFormat): string {
  const core = segment.trim();
  const marker = insideMarker(core, format);
  if (!marker) return segment;
  const lead = segment.length - segment.trimStart().length;
  const inner = core.slice(marker.length, core.length - marker.length);
  return `${segment.slice(0, lead)}${inner}${segment.slice(lead + core.length)}`;
}

function toggleLines(text: string, start: number, end: number, format: InlineFormat): Edit {
  const lines = text.slice(start, end).split('\n');
  const filled = lines.filter((line) => line.trim() !== '');
  const allWrapped = filled.every((line) => insideMarker(line.trim(), format) !== undefined);
  const marker = MARKERS[format][0]!;
  const insert = lines
    .map((line) =>
      allWrapped ? unwrapped(line, format) : wrapped(unwrapped(line, format), marker),
    )
    .join('\n');
  return { start, end, insert, selectStart: start, selectEnd: start + insert.length };
}

export function toggleInline(text: string, start: number, end: number, format: InlineFormat): Edit {
  const selected = text.slice(start, end);
  if (selected.includes('\n')) return toggleLines(text, start, end, format);
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
    insert: wrapped(selected, marker),
    selectStart: coreStart,
    selectEnd: coreStart + core.length,
  };
}

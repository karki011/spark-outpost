export type RowTier = 'act' | 'mark' | 'prose';

export interface OutlineRow {
  text: string;
  depth: number;
  tier: RowTier;
  ref: string | null;
}

export interface BudgetPage {
  text: string;
  total: number;
  offset: number;
  nextOffset: number | null;
  leftOut: number;
}

interface ProseRun {
  start: number;
  end: number;
  keptUntil: number;
}

const LINE_ROOM = 100;
const MARKER_ROOM = 72;

function clip(line: string, max: number): string {
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

function kept(rows: readonly OutlineRow[], index: number): boolean {
  const row = rows[index]!;
  if (row.tier !== 'prose') return true;
  if (!/^- (StaticText|static text)\b/.test(row.text.trimStart())) return false;
  const beside = [rows[index - 1], rows[index + 1]];
  return beside.some((other) => other?.tier === 'act' && other.depth === row.depth);
}

function enclosingRef(rows: readonly OutlineRow[], index: number): string | null {
  const depth = rows[index]!.depth;
  for (let at = index - 1; at >= 0; at -= 1) {
    const row = rows[at]!;
    if (row.depth < depth && row.ref) return row.ref;
  }
  return null;
}

function marker(rows: readonly OutlineRow[], run: ProseRun): string {
  const count = run.end - run.keptUntil;
  const ref = enclosingRef(rows, run.keptUntil);
  const how = ref ? `read ${ref}` : 'read mode text';
  const indent = '  '.repeat(Math.min(rows[run.keptUntil]!.depth, 10));
  return `${indent}- [${count} line${count === 1 ? '' : 's'} left out: ${how}]`;
}

function fitsWhole(lines: readonly string[], maxChars: number): boolean {
  let size = 0;
  for (const line of lines) {
    size += line.length + 1;
    if (size > maxChars + 1) return false;
  }
  return true;
}

export function budgetPage(
  rows: readonly OutlineRow[],
  offset: number,
  maxChars: number,
): BudgetPage {
  const start = Math.min(offset, rows.length);
  const lineMax = Math.max(1, maxChars - LINE_ROOM);
  const lines = rows.map((row) => clip(row.text, lineMax));
  const rest = lines.slice(start);
  if (fitsWhole(rest, maxChars)) {
    return {
      text: rest.join('\n'),
      total: rows.length,
      offset: start,
      nextOffset: null,
      leftOut: 0,
    };
  }
  const runs: ProseRun[] = [];
  let open: ProseRun | null = null;
  let size = 0;
  let end = start;
  for (let index = start; index < rows.length; index += 1) {
    const cost = kept(rows, index) ? lines[index]!.length + 1 : open ? 0 : MARKER_ROOM;
    if (end > start && size + cost > maxChars) break;
    size += cost;
    end = index + 1;
    if (kept(rows, index)) {
      open = null;
    } else if (open) {
      open.end = index + 1;
    } else {
      open = { start: index, end: index + 1, keptUntil: index };
      runs.push(open);
    }
  }
  let room = maxChars - size;
  filling: for (const run of runs) {
    for (let index = run.start; index < run.end; index += 1) {
      const cost = lines[index]!.length + 1;
      if (cost > room) break filling;
      room -= cost;
      run.keptUntil = index + 1;
    }
    room += MARKER_ROOM;
  }
  const out: string[] = [];
  let leftOut = 0;
  const runAt = new Map(runs.map((run) => [run.start, run]));
  for (let index = start; index < end; index += 1) {
    const run = runAt.get(index);
    if (!run) {
      out.push(lines[index]!);
      continue;
    }
    out.push(...lines.slice(run.start, run.keptUntil));
    if (run.keptUntil < run.end) {
      out.push(marker(rows, run));
      leftOut += run.end - run.keptUntil;
    }
    index = run.end - 1;
  }
  return {
    text: out.join('\n'),
    total: rows.length,
    offset: start,
    nextOffset: end < rows.length ? end : null,
    leftOut,
  };
}

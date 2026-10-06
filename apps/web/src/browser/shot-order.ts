import type { BrowserShot } from '@spark-outpost/contracts';

export type ReplyPart =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'shots'; key: string; shots: BrowserShot[] };

const THUMB_WIDTH = 160;
const THUMB_HEIGHT = 120;

export function thumbSize(width: number, height: number): { width: number; height: number } {
  const shown = Math.max(1, Math.min(THUMB_WIDTH, width));
  const scaled = Math.round((height * shown) / Math.max(1, width));
  return { width: shown, height: Math.max(1, Math.min(THUMB_HEIGHT, scaled)) };
}

function nearestEnd(text: string, snippet: string, offset: number): number | null {
  let best: number | null = null;
  for (let at = text.indexOf(snippet); at !== -1; at = text.indexOf(snippet, at + 1)) {
    const end = at + snippet.length;
    if (best === null || Math.abs(end - offset) < Math.abs(best - offset)) best = end;
  }
  return best;
}

export function anchorIndex(text: string, shot: BrowserShot): number | null {
  if (shot.textOffset === null) return null;
  const before = shot.textBefore ?? '';
  const held = shot.textHeld ?? 0;
  if (before.trim() === '') return Math.min(shot.textOffset, text.length);
  const expected = shot.textOffset - held;
  const exact = nearestEnd(text, before, expected);
  if (exact !== null) return Math.min(exact + held, text.length);
  const trimmed = nearestEnd(text, before.trim(), expected);
  if (trimmed === null) return null;
  return before === before.trimEnd() ? Math.min(trimmed + held, text.length) : trimmed;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function outsideFence(text: string, index: number): number {
  let open: string | null = null;
  let lineStart = 0;
  for (const line of text.split('\n')) {
    if (open === null && lineStart >= index) return index;
    const lineEnd = lineStart + line.length;
    const marker = FENCE.exec(line)?.[1]?.[0] ?? null;
    if (marker !== null && open === null) {
      open = marker;
    } else if (marker !== null && marker === open) {
      open = null;
      if (lineEnd >= index) return lineEnd;
    }
    lineStart = lineEnd + 1;
  }
  return open === null ? index : text.length;
}

interface Placed {
  shot: BrowserShot;
  at: number;
  order: number;
}

function placedShots(text: string, shots: readonly BrowserShot[]): Placed[] {
  return shots
    .map((shot, order) => ({
      shot,
      order,
      at: outsideFence(text, anchorIndex(text, shot) ?? text.length),
    }))
    .sort((left, right) => left.at - right.at || left.order - right.order);
}

export function replyParts(text: string, shots: readonly BrowserShot[]): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let from = 0;
  let texts = 0;
  const addText = (to: number) => {
    const slice = text.slice(from, to);
    from = to;
    if (slice.trim() === '') return;
    parts.push({ kind: 'text', key: `text-${texts}`, text: slice });
    texts += 1;
  };
  for (const { shot, at } of placedShots(text, shots)) {
    addText(at);
    const last = parts.at(-1);
    if (last?.kind === 'shots') last.shots.push(shot);
    else parts.push({ kind: 'shots', key: `shots-${shot.id}`, shots: [shot] });
  }
  addText(text.length);
  return parts;
}

export function shotCaption(page: string): string {
  return page.replace(/^https?:\/\//, '');
}

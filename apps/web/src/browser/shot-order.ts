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

export type TextAnchor = Pick<BrowserShot, 'textOffset' | 'textBefore' | 'textHeld'>;

const WORD = /\S/;

function wordEnd(text: string, index: number): number {
  let end = index;
  while (end > 0 && end < text.length && WORD.test(text[end - 1]!) && WORD.test(text[end]!)) {
    end += 1;
  }
  return end;
}

function foundIndex(text: string, shot: TextAnchor, before: string): number | null {
  const held = shot.textHeld ?? 0;
  const expected = (shot.textOffset ?? 0) - held;
  const exact = nearestEnd(text, before, expected);
  if (exact !== null) return Math.min(exact + held, text.length);
  const trimmed = nearestEnd(text, before.trim(), expected);
  if (trimmed === null) return null;
  return before === before.trimEnd() ? Math.min(trimmed + held, text.length) : trimmed;
}

function blankAnchorIndex(text: string, offset: number, before: string, held: number): number {
  const shown = offset - held;
  return shown <= before.length ? 0 : Math.min(offset, text.length);
}

function rawIndex(text: string, shot: TextAnchor): number | null {
  if (shot.textOffset === null) return null;
  if (shot.textBefore === null) return Math.min(shot.textOffset, text.length);
  if (shot.textBefore.trim() === '') {
    return blankAnchorIndex(text, shot.textOffset, shot.textBefore, shot.textHeld ?? 0);
  }
  return foundIndex(text, shot, shot.textBefore);
}

export function anchorIndex(text: string, shot: TextAnchor): number | null {
  const index = rawIndex(text, shot);
  return index === null ? null : wordEnd(text, index);
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

interface FenceSpan {
  start: number;
  end: number | null;
}

function fenceSpans(text: string): FenceSpan[] {
  const spans: FenceSpan[] = [];
  let open: string | null = null;
  let openedAt = 0;
  let lineStart = 0;
  while (lineStart <= text.length) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const marker = FENCE.exec(text.slice(lineStart, lineEnd))?.[1]?.[0] ?? null;
    if (marker !== null && open === null) {
      open = marker;
      openedAt = lineStart;
    } else if (marker !== null && marker === open) {
      open = null;
      spans.push({ start: openedAt, end: lineEnd });
    }
    lineStart = lineEnd + 1;
  }
  if (open !== null) spans.push({ start: openedAt, end: null });
  return spans;
}

const SPAN_CACHE_SIZE = 16;
const spanCache = new Map<string, FenceSpan[]>();

function cachedFenceSpans(text: string): FenceSpan[] {
  const cached = spanCache.get(text);
  if (cached) return cached;
  const spans = fenceSpans(text);
  if (spanCache.size >= SPAN_CACHE_SIZE) spanCache.delete(spanCache.keys().next().value!);
  spanCache.set(text, spans);
  return spans;
}

function spanStartingBefore(spans: readonly FenceSpan[], index: number): FenceSpan | null {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (spans[middle]!.start < index) low = middle + 1;
    else high = middle;
  }
  return spans[low - 1] ?? null;
}

export function outsideFence(text: string, index: number): number {
  const span = spanStartingBefore(cachedFenceSpans(text), index);
  if (!span) return index;
  if (span.end === null) return text.length;
  return index <= span.end ? span.end : index;
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

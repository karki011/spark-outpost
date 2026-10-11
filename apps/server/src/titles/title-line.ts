export const TITLE_REQUEST =
  'End your reply with one last line in the form "Title: <3 to 6 words>" that names what the user asked for in this chat, not your reply or whether you could do it, in sentence case, with no quotes and no trailing period, for example "Title: Fix off-by-one in date divider". Spark Outpost hides that line from the user.';

export function hidesTitleLine(run: { parentRunId: string | null }): boolean {
  return run.parentRunId === null;
}

const TITLE_LINE = /^[\s*_>#-]*title[\s*_]*:[\s*_]*(.*?)[\s*_]*$/i;
const TITLE_START = /^title[\s*_]*(?::.*)?$/i;
const LEADING_MARKUP = /^[\s*_>#-]*/;
const MAX_TITLE_WORDS = 8;
const MAX_TITLE_LENGTH = 60;
const MAX_LINES_AFTER_TITLE = 2;
const MAX_LINE_LENGTH_AFTER_TITLE = 40;

export function cleanTitle(raw: string): string | null {
  const text = raw
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .replace(/[.。]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length > MAX_TITLE_LENGTH) return null;
  if (text.split(' ').length > MAX_TITLE_WORDS) return null;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function titleOfLine(line: string): string | null {
  const match = TITLE_LINE.exec(line);
  return match ? cleanTitle(match[1] ?? '') : null;
}

function mayBecomeTitle(partialLine: string): boolean {
  const text = partialLine.replace(LEADING_MARKUP, '');
  return 'title'.startsWith(text.toLowerCase()) || TITLE_START.test(text);
}

export interface SplitReply {
  text: string;
  title: string | null;
}

function fitsAfterTitle(lines: readonly string[]): boolean {
  const written = lines.map((line) => line.trim()).filter((line) => line !== '');
  return (
    written.length <= MAX_LINES_AFTER_TITLE &&
    written.every((line) => line.length <= MAX_LINE_LENGTH_AFTER_TITLE)
  );
}

function splitClosing(reply: string): SplitReply {
  const lines = reply.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const after = lines.slice(index + 1);
    if (!fitsAfterTitle(after)) break;
    const title = titleOfLine(lines[index]!);
    if (title) return { text: [...lines.slice(0, index), ...after].join('\n').trimEnd(), title };
  }
  return { text: reply, title: null };
}

export function splitTitle(reply: string): SplitReply {
  const filter = createTitleFilter();
  const shown = filter.push(reply);
  const ending = filter.finish();
  return { text: shown + ending.text, title: ending.title };
}

function endsReply(held: string, line: string, end: number): boolean {
  if (end === -1) return mayBecomeTitle(line);
  return titleOfLine(line) !== null && fitsAfterTitle(held.slice(end + 1).split('\n'));
}

function holdFrom(held: string, atLineStart: boolean): number {
  const withBreak = (lineStart: number) =>
    lineStart > 0 && held[lineStart - 1] === '\n' ? lineStart - 1 : lineStart;
  let blankStart: number | null = null;
  let start = 0;
  let first = true;
  while (start <= held.length) {
    const end = held.indexOf('\n', start);
    const complete = end !== -1;
    const line = held.slice(start, complete ? end : held.length);
    const lineStart = !first || atLineStart;
    first = false;
    if (lineStart && line.trim() === '') {
      blankStart ??= withBreak(start);
    } else if (lineStart && endsReply(held, line, end)) {
      return blankStart ?? withBreak(start);
    } else {
      blankStart = null;
    }
    if (!complete) break;
    start = end + 1;
  }
  return blankStart ?? held.length;
}

export interface TitleFilter {
  push(delta: string): string;
  startMessage(onItsWay: number): void;
  finish(): SplitReply;
  pending(): number;
}

interface MessageOpening {
  at: number;
  taken: boolean;
}

export function createTitleFilter(): TitleFilter {
  let held = '';
  let atLineStart = true;
  let opening: MessageOpening | null = { at: 0, taken: false };
  let openingTitle: string | null = null;

  const startsLine = (at: number) => (at === 0 ? atLineStart : held[at - 1] === '\n');

  const takeOpeningTitle = () => {
    while (opening !== null && opening.at <= held.length) {
      const { at, taken } = opening;
      const end = held.indexOf('\n', at);
      const line = held.slice(at, end === -1 ? held.length : end);
      const blank = line.trim() === '';
      const whole = startsLine(at);
      if (end === -1) {
        if (!blank && !(whole && !taken && mayBecomeTitle(line))) opening = null;
        return;
      }
      const title = whole && !taken && !blank ? titleOfLine(line) : null;
      if (title !== null) openingTitle = title;
      if (title !== null || (blank && taken)) {
        held = held.slice(0, at) + held.slice(end + 1);
        opening = { at, taken: true };
      } else if (blank) {
        opening = { at: end + 1, taken };
      } else {
        opening = null;
      }
    }
  };

  return {
    push(delta) {
      held += delta;
      takeOpeningTitle();
      const cut = holdFrom(held, atLineStart);
      const shown = held.slice(0, cut);
      held = held.slice(cut);
      if (shown) atLineStart = shown.endsWith('\n');
      if (opening !== null) opening = { ...opening, at: opening.at - cut };
      return shown;
    },
    startMessage(onItsWay) {
      opening = { at: held.length + onItsWay, taken: false };
    },
    finish() {
      const rest = held;
      held = '';
      const ending = splitClosing(rest);
      return { text: ending.text, title: ending.title ?? openingTitle };
    },
    pending: () => held.length,
  };
}

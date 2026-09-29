import type { AnnotationKind } from '@spark-outpost/contracts';

interface QuoteContent {
  text: string;
  note: string;
}

type QuotedSegment = { kind: 'lead' | 'quote' | 'text'; text: string };

const QUOTE_PREVIEW_LENGTH = 80;
export const LEAD_IN_LATEST = 'Comments on your previous reply:';
export const LEAD_IN_EARLIER = 'Comments on earlier messages:';

const LEAD_INS = new Set([LEAD_IN_LATEST, LEAD_IN_EARLIER]);
const QUOTE_LINE = /^> ?(.*)$/;

const KIND_NOUNS: Record<AnnotationKind, [string, string]> = {
  quote: ['quote', 'quotes'],
  ask: ['question', 'questions'],
  comment: ['comment', 'comments'],
};

export function normalizeQuote(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function quotePreview(text: string, limit = QUOTE_PREVIEW_LENGTH): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1).trimEnd()}…`;
}

export function leadIn(sources: readonly (string | null)[], latestReplyId: string | null): string {
  const allLatest =
    latestReplyId !== null && sources.every((messageId) => messageId === latestReplyId);
  return allLatest ? LEAD_IN_LATEST : LEAD_IN_EARLIER;
}

function blockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

export function composeMessage(
  quotes: readonly QuoteContent[],
  typed: string,
  lead: string,
): string {
  if (quotes.length === 0) return typed;
  const parts = quotes.flatMap(({ text, note }) => {
    const trimmedNote = note.trim();
    return trimmedNote ? [blockquote(text), trimmedNote] : [blockquote(text)];
  });
  const body = typed.trim() ? [typed.trim()] : [];
  return [lead, ...parts, ...body].join('\n\n');
}

export function sendLabel(kinds: readonly AnnotationKind[]): string {
  const [first] = kinds;
  if (!first) return 'Send';
  const kind = kinds.every((each) => each === first) ? first : 'comment';
  const [one, many] = KIND_NOUNS[kind];
  return `Send ${kinds.length} ${kinds.length === 1 ? one : many}`;
}

export function splitQuoted(content: string): QuotedSegment[] {
  const segments: QuotedSegment[] = [];
  const push = (kind: 'quote' | 'text', line: string) => {
    const last = segments.at(-1);
    if (last?.kind === kind) last.text = `${last.text}\n${line}`;
    else segments.push({ kind, text: line });
  };
  for (const line of content.split('\n')) {
    const quoted = QUOTE_LINE.exec(line);
    if (quoted) push('quote', quoted[1] ?? '');
    else push('text', line);
  }
  const trimmed = segments
    .map((segment) =>
      segment.kind === 'text'
        ? { ...segment, text: segment.text.replace(/^\n+|\n+$/g, '') }
        : segment,
    )
    .filter((segment) => segment.kind === 'quote' || segment.text.trim().length > 0);
  const [first] = trimmed;
  if (first?.kind === 'text' && LEAD_INS.has(first.text) && trimmed.length > 1) {
    first.kind = 'lead';
  }
  return trimmed;
}

import { redactText } from '@spark-outpost/contracts';

const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const HTML_IMAGE = /<img\b[^>]*?\balt\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
const LINK = /\[([^\]]+)\]\([^)]*\)/g;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const FENCE = /^\s*(?:```|~~~).*$/gm;
const LINE_PREFIX = /^\s{0,3}(?:#{1,6}\s+|>+\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/gm;
const EMPHASIS = /(\*\*|__|~~|\*|_|`)(?=\S)([\s\S]*?\S)\1/g;
const STRONG = /\*\*/g;
const BADGE_WORD = /\s*\bbadge$/i;
const OPEN_MARK = '\u0001';
const CLOSE_MARK = '\u0002';
const LEADING_IMAGE = new RegExp(`^${OPEN_MARK}([^${CLOSE_MARK}]*)${CLOSE_MARK}\\s*`);
const ANY_IMAGE = new RegExp(`${OPEN_MARK}([^${CLOSE_MARK}]*)${CLOSE_MARK}`, 'g');

function imageWord(alt: string | undefined): string {
  const word = (alt ?? '').trim().replace(BADGE_WORD, '').trim();
  return word ? ` ${OPEN_MARK}${word}${CLOSE_MARK} ` : ' ';
}

function withBadge(text: string): string {
  const lead = LEADING_IMAGE.exec(text);
  const rest = lead ? text.slice(lead[0].length) : text;
  const body = rest.replace(ANY_IMAGE, '$1').replace(/\s+/g, ' ').trim();
  if (!lead) return body;
  return body ? `${lead[1]} · ${body}` : lead[1]!;
}

export function plainText(markdown: string): string {
  const marked = markdown
    .replace(HTML_COMMENT, ' ')
    .replace(FENCE, ' ')
    .replace(IMAGE, (_match, alt: string) => imageWord(alt))
    .replace(HTML_IMAGE, (_match, double?: string, single?: string) => imageWord(double ?? single))
    .replace(LINK, '$1')
    .replace(HTML_TAG, ' ')
    .replace(LINE_PREFIX, '')
    .replace(STRONG, '')
    .replace(EMPHASIS, '$2')
    .replace(EMPHASIS, '$2')
    .replace(/\s+/g, ' ')
    .trim();
  return withBadge(marked);
}

export function plainExcerpt(markdown: string, maxChars: number): string {
  const text = redactText(plainText(markdown));
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}

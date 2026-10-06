import { redactText } from '@spark-outpost/contracts';

const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]+)\]\([^)]*\)/g;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const FENCE = /^\s*(?:```|~~~).*$/gm;
const LINE_PREFIX = /^\s{0,3}(?:#{1,6}\s+|>+\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/gm;
const EMPHASIS = /(\*\*|__|~~|\*|_|`)(?=\S)([\s\S]*?\S)\1/g;

export function plainText(markdown: string): string {
  return markdown
    .replace(HTML_COMMENT, ' ')
    .replace(FENCE, ' ')
    .replace(IMAGE, '$1')
    .replace(LINK, '$1')
    .replace(HTML_TAG, ' ')
    .replace(LINE_PREFIX, '')
    .replace(EMPHASIS, '$2')
    .replace(EMPHASIS, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function plainExcerpt(markdown: string, maxChars: number): string {
  const text = redactText(plainText(markdown));
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}

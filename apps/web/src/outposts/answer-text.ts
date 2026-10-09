import { NEEDS_YOU_PREFIX } from '@spark-outpost/contracts';
import { isLong } from './post-text.ts';

const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const PARAGRAPH_BREAK = '\n\n';

export function isLongMarkdown(text: string): boolean {
  return isLong(text.replace(LINK, '$1'));
}

interface AskedQuestion {
  said: string;
  asks: string[];
}

function isAsk(paragraph: string): boolean {
  return paragraph.trimStart().startsWith(NEEDS_YOU_PREFIX.trimEnd());
}

export function splitQuestion(text: string): AskedQuestion {
  const paragraphs = text.split(PARAGRAPH_BREAK);
  return {
    said: paragraphs
      .filter((paragraph) => !isAsk(paragraph))
      .join(PARAGRAPH_BREAK)
      .trim(),
    asks: paragraphs
      .filter(isAsk)
      .map((paragraph) => paragraph.trimStart().slice(NEEDS_YOU_PREFIX.trimEnd().length).trim())
      .filter((ask) => ask !== ''),
  };
}

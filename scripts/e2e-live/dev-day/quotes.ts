import type { TextAnchor } from '../../../packages/contracts/src/index.ts';
import { ANCHOR_CONTEXT_LENGTH } from '../../../packages/contracts/src/annotations.ts';
import { LEAD_IN_LATEST, composeMessage } from '../../../apps/web/src/chat/quotes/quote-text.ts';

const PASSAGE_MAX = 400;
const EMPTY_REPLY = 'The earlier reply was empty.';

/** The passage a developer would select: the first sentence matching `pick`, else the first. */
export function pickPassage(reply: string, pick: RegExp): string {
  const sentences = reply
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20);
  const chosen = sentences.find((sentence) => pick.test(sentence)) ?? sentences[0] ?? reply.trim();
  return (chosen || EMPTY_REPLY).slice(0, PASSAGE_MAX);
}

/** The anchor the web UI records for a selection, measured on the reply text. */
export function anchorFor(reply: string, passage: string): TextAnchor {
  const found = reply.indexOf(passage);
  const start = found < 0 ? 0 : found;
  const end = start + passage.length;
  return {
    exact: passage,
    prefix: reply.slice(Math.max(0, start - ANCHOR_CONTEXT_LENGTH), start),
    suffix: reply.slice(end, end + ANCHOR_CONTEXT_LENGTH),
    start,
    end,
  };
}

/** The message the composer sends for one quote on the latest reply plus typed text. */
export function quotedMessage(passage: string, typed: string): string {
  return composeMessage([{ text: passage, note: '' }], typed, LEAD_IN_LATEST);
}

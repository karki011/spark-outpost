import { FENCE, LIST_ITEM, splitBlocks } from '../markdown/markdown-blocks.ts';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const MAX_OPTION_LENGTH = 80;

const CLARIFY_FENCE = /^ {0,3}(`{3,}|~{3,})\s*clarify/m;
const MARKER = /^([-*+]|\d{1,9}[.)])\s*/;
const TASK_ITEM = /^\[[ xX]\](\s|$)/;
const LINK_ONLY = /^\[[^\]]*\]\([^)]*\)$/;
const CODE_ONLY = /^`[^`]+`$/;
const PATH_LIKE = /^\S*(\/\S*|\.[a-z0-9]{1,5})$/i;
const LETTER = /\p{L}/u;
const TABLE_OR_QUOTE = /^ {0,3}(\||>)/;

const OPTION_LABEL = /^(option|choice)\s+([a-z]|\d{1,2})\s*[:.)—–-]/i;
const QUESTION_CUE =
  /\b(which|would you|do you want|want me|shall i|should i|prefer|options?|choose|pick)\b/i;
const OFFER_CUE =
  /\b(would you like|would you prefer|want me to|do you want|choose|pick|(your|the|some|a few|two|three|four|five|six|these) options)\b/i;
const OFFER_ITEM = /\b(want me to|should i|shall i|would you like)\b/i;

export interface OptionTurn {
  streaming: boolean;
  succeeded: boolean;
  latest: boolean;
  asked: boolean;
}

interface ListBlock {
  lead: string | null;
  ordered: boolean;
  items: string[];
}

function plain(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function nonBlank(block: string): string[] {
  return block.split('\n').filter((line) => line.trim() !== '');
}

function isItem(line: string): boolean {
  return !/^\s/.test(line) && LIST_ITEM.test(line);
}

function lastSentence(line: string): string {
  const text = plain(line.replace(/^ {0,3}#{1,6}\s+/, ''));
  return text.split(/(?<=[.!])\s+/).at(-1) ?? text;
}

function leadOf(block: string | undefined): string | null {
  if (block === undefined) return null;
  const lines = nonBlank(block);
  const first = lines[0] ?? '';
  if (FENCE.test(first) || TABLE_OR_QUOTE.test(first) || LIST_ITEM.test(first)) return null;
  const last = lines.at(-1);
  return last === undefined ? null : lastSentence(last);
}

function listBlock(blocks: readonly string[]): ListBlock | null {
  const block = blocks.at(-1) ?? '';
  const lines = nonBlank(block);
  const start = lines.findIndex(isItem);
  if (start === -1 || lines.some((line) => FENCE.test(line))) return null;
  const itemLines = lines.slice(start);
  if (!itemLines.every(isItem)) return null;
  const leadLine = start > 0 ? lines[start - 1] : undefined;
  if (start > 0 && lines.slice(0, start).some((line) => TABLE_OR_QUOTE.test(line))) return null;
  const markers = new Set(itemLines.map((line) => /^\d/.test(line)));
  if (markers.size !== 1) return null;
  return {
    lead: leadLine === undefined ? leadOf(blocks.at(-2)) : lastSentence(leadLine),
    ordered: markers.has(true),
    items: itemLines.map((line) => line.replace(MARKER, '')),
  };
}

function usableItem(raw: string): boolean {
  if (TASK_ITEM.test(raw)) return false;
  const trimmed = raw.trim();
  if (LINK_ONLY.test(trimmed) || CODE_ONLY.test(trimmed)) return false;
  const text = plain(trimmed);
  return (
    text.length > 0 &&
    text.length <= MAX_OPTION_LENGTH &&
    LETTER.test(text) &&
    !PATH_LIKE.test(text)
  );
}

function leadOffers(lead: string | null, ordered: boolean): boolean {
  if (lead === null) return false;
  if (lead.endsWith('?')) return QUESTION_CUE.test(lead);
  if (ordered || lead.endsWith('.')) return false;
  return OFFER_CUE.test(lead);
}

function itemsOffer(items: readonly string[]): boolean {
  return (
    items.every((item) => OPTION_LABEL.test(item)) ||
    items.every((item) => item.endsWith('?') && OFFER_ITEM.test(item))
  );
}

export function replyOptions(text: string): string[] {
  if (CLARIFY_FENCE.test(text)) return [];
  const list = listBlock(splitBlocks(text.trim()));
  if (!list) return [];
  const { items } = list;
  if (items.length < MIN_OPTIONS || items.length > MAX_OPTIONS) return [];
  if (!items.every(usableItem)) return [];
  const options = items.map(plain);
  if (new Set(options).size !== options.length) return [];
  return leadOffers(list.lead, list.ordered) || itemsOffer(options) ? options : [];
}

export function withoutOptionList(text: string): string {
  const lines = text.trimEnd().split('\n');
  while (lines.length > 0 && (isItem(lines.at(-1) ?? '') || lines.at(-1)?.trim() === '')) {
    lines.pop();
  }
  return lines.join('\n');
}

export function turnReplyOptions(text: string, turn: OptionTurn): string[] {
  if (turn.streaming || !turn.succeeded || !turn.latest || turn.asked) return [];
  return replyOptions(text);
}

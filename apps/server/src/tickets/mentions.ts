import type { TicketSourceId } from '@spark-outpost/contracts';

export interface TicketMention {
  key: string;
  source: TicketSourceId | null;
  site: string | null;
}

const MAX_MENTIONS = 5;
const URL_PATTERN = /https?:\/\/[^\s<>()[\]"'`]+/gi;
const KEY_PATTERN = /(?<![\w/.-])([A-Z][A-Z0-9_]{1,9}-[1-9]\d{0,6})(?![\w-])/g;
const LINEAR_PATH = /^\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9_]*-\d+)(?:\/|$)/;
const JIRA_PATH = /^\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)\/?$/;
const JIRA_SELECTED = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

function mentionInUrl(text: string): TicketMention | null {
  let url: URL;
  try {
    url = new URL(text.replace(/[.,;:!?]+$/, ''));
  } catch {
    return null;
  }
  if (url.hostname === 'linear.app') {
    const key = LINEAR_PATH.exec(url.pathname)?.[1];
    return key ? { key: key.toUpperCase(), source: 'linear', site: null } : null;
  }
  const browse = JIRA_PATH.exec(url.pathname)?.[1];
  const selected = url.searchParams.get('selectedIssue');
  const key = browse ?? (selected && JIRA_SELECTED.test(selected) ? selected : null);
  return key ? { key: key.toUpperCase(), source: 'jira', site: url.origin.toLowerCase() } : null;
}

export function ticketMentions(text: string): TicketMention[] {
  const found: TicketMention[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const mention = mentionInUrl(match[0]);
    if (mention) found.push(mention);
  }
  for (const match of text.replace(URL_PATTERN, ' ').matchAll(KEY_PATTERN)) {
    found.push({ key: match[1]!, source: null, site: null });
  }
  const seen = new Set<string>();
  return found
    .filter((mention) => {
      if (seen.has(mention.key)) return false;
      seen.add(mention.key);
      return true;
    })
    .slice(0, MAX_MENTIONS);
}

export type MentionIntent = 'target' | 'reference';

const REFERENCE_CUE =
  /\b(?:see|like|similar to|same as|as in|related to|based on|per|cf\.?|compare|compared to|compare with|vs\.?|versus|analy[sz]e|analy[sz]is of|look at|looks like|mentioned in|from|reference|referencing|following|after|before|duplicate of|dupe of|copy|check|read|explain|summari[sz]e|review|about|what is|what's|blocked by|depends on|see also)\s*(?:the\s+|ticket\s+|issue\s+)*[:(]?\s*$/i;
const WORK_VERB =
  /\b(?:fix|fixes|fixing|implement|implementing|work on|working on|resolve|resolves|close|closes|complete|finish|tackle|address|handle|solve|build|do|pick up|start on|ship)\b/i;
const KEY_ONLY = /^[\s[(]*$/;

function textAround(text: string, mention: TicketMention) {
  const cleaned = text.replace(URL_PATTERN, (url) =>
    mentionInUrl(url)?.key === mention.key ? mention.key : ' ',
  );
  const at = cleaned.search(new RegExp(`(?<![\\w-])${escapeKey(mention.key)}(?![\\w-])`, 'i'));
  return at < 0
    ? null
    : { before: cleaned.slice(0, at), after: cleaned.slice(at + mention.key.length) };
}

export function mentionIntent(text: string, mention: TicketMention): MentionIntent {
  const around = textAround(text, mention);
  if (!around) return 'reference';
  const { before, after } = around;
  if (KEY_ONLY.test(before) && /^[\s\])]*(?:$|[:\-–—]|\s+\S)/.test(after)) return 'target';
  const sentence = before.split(/[.!?\n;]/).at(-1) ?? '';
  if (REFERENCE_CUE.test(sentence)) return 'reference';
  return WORK_VERB.test(sentence) ? 'target' : 'reference';
}

const escapeKey = (key: string) => key.replace(/[^A-Za-z0-9]/g, (char) => `\\${char}`);

function mentionsKey(text: string, key: string): boolean {
  return new RegExp(`(?<![\\w-])${escapeKey(key)}(?![\\w-])`, 'i').test(text);
}

export function titleWithKeys(title: string, keys: readonly string[]): string {
  const missing = keys.filter((key) => !mentionsKey(title, key));
  return missing.length > 0 ? `${missing.join(', ')}: ${title}` : title;
}

export function branchTitleWithKeys(
  title: string,
  keys: readonly string[],
  drop: readonly string[] = [],
): string {
  const rest = [...keys, ...drop].reduce(
    (text, key) => text.replace(new RegExp(`(?<![\\w-])${escapeKey(key)}(?![\\w-]):?`, 'gi'), ' '),
    title,
  );
  return `${keys.join(' ')} ${rest.replace(/\s+/g, ' ').trim()}`.trim();
}

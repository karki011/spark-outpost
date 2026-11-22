import type { GithubInboxGroup, GithubInboxItem } from '@spark-outpost/contracts';
import { GROUPS } from './github-model.ts';

type MatchField = 'title' | 'number' | 'repo' | 'author' | 'branch' | 'ticket' | 'label' | 'body';

export interface HiddenMatch {
  where: 'branch' | 'body';
  text: string;
}

export interface ItemMatch {
  item: GithubInboxItem;
  hidden: HiddenMatch | null;
}

const SHOWN = new Set<MatchField>(['title', 'number', 'repo', 'author', 'ticket', 'label']);

const SNIPPET_SIDE = 40;

export function searchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function fieldsOf(item: GithubInboxItem): [MatchField, string][] {
  return [
    ['title', item.title],
    ['number', `#${item.number}`],
    ['repo', item.repo],
    ['author', item.author],
    ['branch', `${item.headRef} ${item.baseRef}`],
    ['ticket', item.ticket?.key ?? ''],
    ['label', item.labels.map((label) => label.name).join(' ')],
    ['body', item.bodyPreview],
  ];
}

function bodySnippet(body: string, term: string): string {
  const flat = body.replace(/\s+/g, ' ');
  const at = flat.toLowerCase().indexOf(term);
  if (at === -1) return flat.slice(0, SNIPPET_SIDE * 2);
  const start = Math.max(0, at - SNIPPET_SIDE);
  const end = Math.min(flat.length, at + term.length + SNIPPET_SIDE);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

export function matchItem(item: GithubInboxItem, terms: readonly string[]): ItemMatch | null {
  if (terms.length === 0) return { item, hidden: null };
  const fields = fieldsOf(item).map(([field, text]) => [field, text.toLowerCase()] as const);
  if (!terms.every((term) => fields.some(([, text]) => text.includes(term)))) return null;
  const unseen = terms.find(
    (term) => !fields.some(([field, text]) => SHOWN.has(field) && text.includes(term)),
  );
  if (!unseen) return { item, hidden: null };
  const inBranch = fields.some(([field, text]) => field === 'branch' && text.includes(unseen));
  return {
    item,
    hidden: inBranch
      ? { where: 'branch', text: `${item.headRef} → ${item.baseRef}` }
      : { where: 'body', text: bodySnippet(item.bodyPreview, unseen) },
  };
}

export function searchItems(
  items: readonly GithubInboxItem[],
  terms: readonly string[],
): ItemMatch[] {
  return items.flatMap((item) => matchItem(item, terms) ?? []);
}

export function matchCounts(matches: readonly ItemMatch[]): Record<GithubInboxGroup, number> {
  const counts = Object.fromEntries(GROUPS.map((group) => [group, 0])) as Record<
    GithubInboxGroup,
    number
  >;
  for (const match of matches) counts[match.item.group] += 1;
  return counts;
}

export interface TextPart {
  text: string;
  hit: boolean;
}

export function highlightParts(text: string, terms: readonly string[]): TextPart[] {
  if (terms.length === 0 || text === '') return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const hits = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + 1)) {
      hits.fill(true, at, at + term.length);
    }
  }
  const parts: TextPart[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const last = parts.at(-1);
    if (last && last.hit === hits[index]) last.text += text[index];
    else parts.push({ text: text[index]!, hit: hits[index]! });
  }
  return parts;
}

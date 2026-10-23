const ALL_HANDLE = 'all';
const MENTION = /(^|[\s([{"'])@([a-z0-9-]+)(?=[.,:;!?)\]}"']*(?:\s|$))/gi;
const LEADING_HANDLE = /^@([a-z0-9-]+)[:,]?\s+([\s\S]+)$/i;
const SAYS_NOTHING = /^[\s.,:;!?()[\]{}"']*$/;

export type UserAddress =
  { kind: 'request'; to: string[]; body: string } | { kind: 'note'; body: string };

function mentioned(text: string): string[] {
  return [...text.matchAll(MENTION)].map((match) => (match[2] ?? '').toLowerCase());
}

export function mentionsSomeone(text: string): boolean {
  return mentioned(text).length > 0;
}

export function addressees(text: string, handles: readonly string[]): string[] {
  const asked: string[] = [];
  const mentions = mentioned(text);
  const typed = mentions.filter((handle) => handles.includes(handle));
  const everyone = mentions.includes(ALL_HANDLE) ? handles : [];
  for (const handle of [...typed, ...everyone]) {
    if (!asked.includes(handle)) asked.push(handle);
  }
  return asked;
}

function saysSomething(text: string): boolean {
  return !SAYS_NOTHING.test(text.replace(MENTION, '$1'));
}

function afterLeadingHandle(text: string, handle: string): string | null {
  const match = LEADING_HANDLE.exec(text);
  if (!match || (match[1] ?? '').toLowerCase() !== handle) return null;
  return (match[2] ?? '').trim();
}

export function userAddress(
  text: string,
  handles: readonly string[],
  kept?: readonly string[],
): UserAddress {
  const body = text.trim();
  const found = addressees(body, handles);
  const to = kept === undefined ? found : found.filter((handle) => kept.includes(handle));
  if (to.length === 0 || !saysSomething(body)) return { kind: 'note', body };
  const only = to.length === 1 ? to[0] : undefined;
  const rest = only === undefined ? null : afterLeadingHandle(body, only);
  return { kind: 'request', to, body: rest ?? body };
}

const JOINER = /^[\s.,:;!?()[\]{}"'&]*(?:(?:and|or)[\s.,:;!?()[\]{}"']*)?$/i;

interface Mention {
  handle: string;
  start: number;
  end: number;
}

function askedMentions(text: string, asked: readonly string[]): Mention[] {
  return [...text.matchAll(MENTION)]
    .map((match) => {
      const start = match.index + (match[1] ?? '').length;
      return { handle: (match[2] ?? '').toLowerCase(), start, end: start + 1 + (match[2] ?? '').length };
    })
    .filter((mention) => asked.includes(mention.handle));
}

function partOf(text: string, mentions: readonly Mention[], own: number): string {
  let last = own;
  while (last + 1 < mentions.length) {
    const between = text.slice(mentions[last]!.end, mentions[last + 1]!.start);
    if (!JOINER.test(between)) break;
    last += 1;
  }
  const next = mentions[last + 1];
  return text.slice(mentions[last]!.end, next?.start ?? text.length);
}

export function requestFor(text: string, handle: string, asked: readonly string[]): string {
  const own = handle.toLowerCase();
  if (asked.length < 2 || mentioned(text).includes(ALL_HANDLE)) return text;
  const mentions = askedMentions(text, asked);
  const at = mentions.findIndex((mention) => mention.handle === own);
  if (at === -1) return text;
  const part = partOf(text, mentions, at).replace(/^[\s,:;]+/, '').trim();
  return saysSomething(part) ? part : text;
}

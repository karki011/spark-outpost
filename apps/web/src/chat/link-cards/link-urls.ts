import { splitQuoted } from '../quotes/quote-text.ts';

export interface LinkAddress {
  href: string;
  host: string;
  path: string;
}

const CANDIDATE = /(?<![a-z0-9])https?:\/\/[^\s<>`"]+/gi;
const FENCED_CODE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm;
const INLINE_CODE = /(`+)[\s\S]*?\1/g;
const TRAILING_PUNCTUATION = /[.,:;!?'*_~]$/;
const PAIRS: Record<string, string> = { ')': '(', ']': '[' };

function count(text: string, character: string): number {
  return text.split(character).length - 1;
}

function trimTrailing(candidate: string): string {
  let text = candidate;
  for (;;) {
    const last = text.at(-1) ?? '';
    const opener = PAIRS[last];
    if (TRAILING_PUNCTUATION.test(last)) text = text.slice(0, -1);
    else if (opener && count(text, last) > count(text, opener)) text = text.slice(0, -1);
    else return text;
  }
}

function withoutCode(text: string): string {
  return text.replace(FENCED_CODE, ' ').replace(INLINE_CODE, ' ');
}

function typedText(text: string): string {
  const segments = splitQuoted(text);
  if (segments[0]?.kind !== 'lead') return text;
  return segments
    .filter((segment) => segment.kind === 'text')
    .map((segment) => segment.text)
    .join('\n');
}

function shortPath(url: URL): string {
  const segments = url.pathname.split('/').filter(Boolean);
  const path =
    segments.length > 2
      ? `/${segments[0]}/…/${segments.at(-1)}`
      : segments.map((s) => `/${s}`).join('');
  const rest = `${url.search ? '?…' : ''}${url.hash ? '#…' : ''}`;
  return `${path}${rest}`;
}

function linkAddress(candidate: string): LinkAddress | null {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || !url.host) return null;
  return { href: url.href, host: url.host, path: shortPath(url) };
}

export function linkAddresses(text: string): LinkAddress[] {
  const seen = new Set<string>();
  const found: LinkAddress[] = [];
  for (const match of withoutCode(typedText(text)).matchAll(CANDIDATE)) {
    const address = linkAddress(trimTrailing(match[0]));
    if (!address || seen.has(address.href)) continue;
    seen.add(address.href);
    found.push(address);
  }
  return found;
}

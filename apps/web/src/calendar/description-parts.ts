import { joinLink, type JoinLink } from '@spark-outpost/contracts';

export type DescriptionPart =
  | { kind: 'text'; text: string }
  | { kind: 'link'; url: string; host: string; join: JoinLink | null }
  | { kind: 'phone'; text: string; number: string };

const LINK = /https:\/\/[^\s<>"'`]+/;
const INTL_PHONE = /(?<![\w+])\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){1,4}(?:[ .-]?\d{2,4})(?![\w])/;
const US_PHONE = /(?<![\w(])\(\d{3}\) ?\d{3}-\d{4}(?![\w])/;
const TOKEN = new RegExp(`${LINK.source}|${INTL_PHONE.source}|${US_PHONE.source}`, 'g');
const TRAILING = /[.,;:!?'"]+$/;
const PHONE_DIGITS = { min: 7, max: 15 };
const ADDRESS_START = /^\d{1,6}[a-z]?\s+\p{L}{2,}/iu;
const POSTCODE = /\b\d{5}(?:-\d{4})?\b|\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/;

function trimLink(raw: string): string {
  let link = raw.replace(TRAILING, '');
  while (link.endsWith(')') && !link.includes('(')) link = link.slice(0, -1).replace(TRAILING, '');
  return link;
}

function safeHttps(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function linkPart(raw: string): (DescriptionPart & { kind: 'link' }) | null {
  const url = safeHttps(raw);
  if (!url) return null;
  const join = joinLink({ url: raw, location: null, noteLinks: [] });
  return { kind: 'link', url: url.toString(), host: join?.host ?? url.hostname, join };
}

function phonePart(raw: string): DescriptionPart | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < PHONE_DIGITS.min || digits.length > PHONE_DIGITS.max) return null;
  const number = raw.trim().startsWith('+') ? `+${digits}` : digits;
  return { kind: 'phone', text: raw, number };
}

function unwrapBrackets(text: string): string {
  return text
    .replace(/[ \t]*<(https:\/\/[^\s<>]+)>/g, ' $1')
    .replace(/[ \t]*\((https:\/\/[^\s()]+)\)/g, ' $1');
}

function pushText(parts: DescriptionPart[], text: string) {
  if (!text) return;
  const last = parts.at(-1);
  if (last?.kind === 'text') last.text += text;
  else parts.push({ kind: 'text', text });
}

export function descriptionParts(source: string): DescriptionPart[] {
  const text = unwrapBrackets(source);
  const parts: DescriptionPart[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index;
    const raw = match[0].startsWith('https://') ? trimLink(match[0]) : match[0];
    const part = raw.startsWith('https://') ? linkPart(raw) : phonePart(raw);
    if (!part) continue;
    pushText(parts, text.slice(at, start));
    parts.push(part);
    at = start + raw.length;
  }
  pushText(parts, text.slice(at));
  return parts;
}

export function looksLikeAddress(location: string): boolean {
  const text = location.trim();
  if (!text || /https?:\/\//i.test(text)) return false;
  return POSTCODE.test(text) || (ADDRESS_START.test(text) && text.includes(','));
}

export function mapsUrl(location: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(location.trim())}`;
}

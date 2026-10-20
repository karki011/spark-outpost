const HTML_TAG =
  /<\/?(br|p|div|span|ul|ol|li|a|b|i|u|em|strong|font|html|body|table|tr|td|h[1-6])\b[^>]*>/i;
const ENCODED_TAG = /&lt;\/?(br|p|div|ul|ol|li|a|b|u|span)\b/i;
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s[^>]*)?)\/?>/y;
const HIDDEN = new Set(['script', 'style', 'head', 'title', 'template', 'xml', 'noscript']);
const BLOCK = new Set(['p', 'div', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const GOOGLE_REDIRECT_HOSTS = new Set(['www.google.com', 'google.com']);

const NAMED: Record<string, string> = {
  nbsp: ' ',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
};

function fromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
  if (code >= 0xd800 && code <= 0xdfff) return '';
  return String.fromCodePoint(code);
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d{1,7});/g, (_, digits: string) => fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) => fromCodePoint(parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED[name.toLowerCase()] ?? whole)
    .replace(/&amp;/gi, '&')
    .replace(/\u00a0/g, ' ');
}

export function looksLikeHtml(text: string): boolean {
  return HTML_TAG.test(text) || ENCODED_TAG.test(text);
}

function unwrapRedirect(url: URL): URL {
  if (!GOOGLE_REDIRECT_HOSTS.has(url.hostname) || url.pathname !== '/url') return url;
  const target = safeHttps(url.searchParams.get('q') ?? '');
  return target ?? url;
}

function safeHttps(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function hrefOf(attributes: string): string | null {
  const match = HREF.exec(attributes);
  if (!match) return null;
  const url = safeHttps(decodeEntities(match[1] ?? match[2] ?? match[3] ?? ''));
  return url ? unwrapRedirect(url).toString() : null;
}

const bare = (value: string) =>
  value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();

function anchorText(label: string, href: string | null): string {
  const text = label.replace(/\s+/g, ' ').trim();
  if (!href) return text;
  if (!text || bare(text) === bare(href)) return href;
  return `${text} (${href})`;
}

interface ListLevel {
  ordered: boolean;
  count: number;
}

class Writer {
  private out = '';
  private anchor: { href: string | null; label: string } | null = null;
  readonly lists: ListLevel[] = [];

  text(value: string) {
    if (this.anchor) this.anchor.label += value;
    else if (value.trim() || !this.atLineStart()) this.out += value;
  }

  private atLineStart(): boolean {
    return this.out === '' || this.out.endsWith('\n');
  }

  newline() {
    this.closeAnchor();
    this.out += '\n';
  }

  line() {
    this.closeAnchor();
    if (this.out !== '' && !this.out.endsWith('\n')) this.out += '\n';
  }

  openAnchor(href: string | null) {
    this.closeAnchor();
    this.anchor = { href, label: '' };
  }

  closeAnchor() {
    if (!this.anchor) return;
    const { href, label } = this.anchor;
    this.anchor = null;
    this.out += anchorText(label, href);
  }

  item() {
    const level = this.lists.at(-1);
    this.line();
    const indent = '  '.repeat(Math.max(this.lists.length - 1, 0));
    if (!level) return;
    level.count += 1;
    this.out += `${indent}${level.ordered ? `${level.count}.` : '•'} `;
  }

  result(): string {
    this.closeAnchor();
    return this.out;
  }
}

function skipHidden(html: string, name: string, from: number): number {
  const close = new RegExp(`</${name}\\s*>`, 'ig');
  close.lastIndex = from;
  const found = close.exec(html);
  return found ? found.index + found[0].length : html.length;
}

function handleTag(writer: Writer, closing: boolean, name: string, attributes: string) {
  if (name === 'br') writer.newline();
  else if (BLOCK.has(name)) writer.line();
  else if (name === 'ul' || name === 'ol') {
    if (closing) writer.lists.pop();
    else writer.lists.push({ ordered: name === 'ol', count: 0 });
    writer.line();
  } else if (name === 'li') {
    if (closing) writer.line();
    else writer.item();
  } else if (name === 'a') {
    if (closing) writer.closeAnchor();
    else writer.openAnchor(hrefOf(attributes));
  }
}

function collapse(text: string, keepNewlines: boolean): string {
  const spaced = keepNewlines ? text : text.replace(/\s*\n\s*/g, ' ');
  return decodeEntities(spaced.replace(/[ \t\f\v\r]+/g, ' '));
}

function walk(html: string): string {
  const writer = new Writer();
  const keepNewlines = !/<(p|div|html|body|table)\b/i.test(html);
  let at = 0;
  while (at < html.length) {
    if (html.startsWith('<!--', at)) {
      const end = html.indexOf('-->', at + 4);
      at = end === -1 ? html.length : end + 3;
      continue;
    }
    TAG.lastIndex = at;
    const tag = TAG.exec(html);
    if (tag) {
      const closing = tag[1] === '/';
      const name = tag[2]!.toLowerCase();
      at = TAG.lastIndex;
      if (!closing && HIDDEN.has(name)) at = skipHidden(html, name, at);
      else handleTag(writer, closing, name, tag[3] ?? '');
      continue;
    }
    const next = html.indexOf('<', at + 1);
    const end = next === -1 ? html.length : next;
    writer.text(collapse(html.slice(at, end), keepNewlines));
    at = end;
  }
  return writer.result();
}

function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^ +(?![ ]*(•|\d+\.) )/, '')
        .replace(/(\S) {2,}/g, '$1 ')
        .replace(/ +$/, ''),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function htmlNotesText(notes: string): string {
  if (!looksLikeHtml(notes)) return notes;
  const html = HTML_TAG.test(notes) ? notes : decodeEntities(notes);
  return tidy(walk(html));
}

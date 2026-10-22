export type Mark = 'marker' | 'strong' | 'em' | 'strike' | 'code' | 'link' | 'url' | 'mention';

export interface Span {
  text: string;
  marks: readonly Mark[];
}

interface Token {
  spans: Span[];
  end: number;
}

interface Delimiter {
  marker: string;
  mark: Mark;
}

const DELIMITERS: readonly Delimiter[] = [
  { marker: '**', mark: 'strong' },
  { marker: '__', mark: 'strong' },
  { marker: '~~', mark: 'strike' },
  { marker: '*', mark: 'em' },
  { marker: '_', mark: 'em' },
];
const LINK = /\[([^\]\n]{1,500})\]\(([^()\s]{1,2000})\)/y;
const MENTION = /@[A-Za-z0-9][\w.-]*/y;
const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/;

function isWord(char: string | undefined): boolean {
  return char !== undefined && WORD.test(char);
}

function isSpace(char: string | undefined): boolean {
  return char === undefined || SPACE.test(char);
}

function canOpen(text: string, at: number, delimiter: Delimiter): boolean {
  const after = text[at + delimiter.marker.length];
  if (isSpace(after) || after === delimiter.marker[0]) return false;
  return !(delimiter.marker[0] === '_' && isWord(text[at - 1]));
}

function closesAt(text: string, at: number, delimiter: Delimiter): boolean {
  const { marker } = delimiter;
  if (!text.startsWith(marker, at) || isSpace(text[at - 1])) return false;
  const char = marker[0]!;
  const after = text[at + marker.length];
  if (marker.length === 1 && (after === char || text[at - 1] === char)) return false;
  return !(char === '_' && isWord(after));
}

function findClose(text: string, from: number, delimiter: Delimiter): number {
  let at = text.indexOf(delimiter.marker, from);
  while (at !== -1) {
    if (closesAt(text, at, delimiter)) return at;
    at = text.indexOf(delimiter.marker, at + 1);
  }
  return -1;
}

function backtickRun(text: string, at: number): number {
  let end = at;
  while (text[end] === '`') end += 1;
  return end - at;
}

function findBackticks(text: string, from: number, length: number): number {
  let at = text.indexOf('`', from);
  while (at !== -1) {
    const run = backtickRun(text, at);
    if (run === length) return at;
    at = text.indexOf('`', at + run);
  }
  return -1;
}

function push(spans: Span[], span: Span): void {
  const last = spans.at(-1);
  if (last && last.marks === span.marks) last.text += span.text;
  else spans.push({ ...span });
}

class Scanner {
  private readonly missing = new Set<string>();

  constructor(
    private readonly text: string,
    private readonly marks: readonly Mark[],
  ) {}

  spans(): Span[] {
    const { text } = this;
    const spans: Span[] = [];
    let plainFrom = 0;
    let at = 0;
    while (at < text.length) {
      const token = this.token(at);
      if (token === null) {
        at += 1;
        continue;
      }
      if (at > plainFrom) push(spans, { text: text.slice(plainFrom, at), marks: this.marks });
      for (const span of token.spans) if (span.text !== '') push(spans, span);
      at = token.end;
      plainFrom = at;
    }
    if (text.length > plainFrom) push(spans, { text: text.slice(plainFrom), marks: this.marks });
    return spans;
  }

  private with(...added: Mark[]): Mark[] {
    return [...this.marks, ...added];
  }

  private marker(text: string): Span {
    return { text, marks: this.with('marker') };
  }

  private token(at: number): Token | null {
    const char = this.text[at];
    if (char === '`') return this.code(at);
    if (char === '[') return this.link(at);
    if (char === '@') return this.mention(at);
    if (char === '*' || char === '_' || char === '~') return this.emphasis(at);
    return null;
  }

  private code(at: number): Token | null {
    const length = backtickRun(this.text, at);
    const key = `\`${length}`;
    const close = this.missing.has(key) ? -1 : findBackticks(this.text, at + length, length);
    if (close === -1) {
      this.missing.add(key);
      return {
        spans: [{ text: this.text.slice(at, at + length), marks: this.marks }],
        end: at + length,
      };
    }
    const fence = this.text.slice(at, at + length);
    return {
      spans: [
        this.marker(fence),
        { text: this.text.slice(at + length, close), marks: this.with('code') },
        this.marker(fence),
      ],
      end: close + length,
    };
  }

  private link(at: number): Token | null {
    LINK.lastIndex = at;
    const match = LINK.exec(this.text);
    if (!match) return null;
    const [whole, label = '', url = ''] = match;
    return {
      spans: [
        this.marker('['),
        ...new Scanner(label, this.with('link')).spans(),
        this.marker(']('),
        { text: url, marks: this.with('marker', 'url') },
        this.marker(')'),
      ],
      end: at + whole.length,
    };
  }

  private mention(at: number): Token | null {
    if (!isSpace(this.text[at - 1]) && this.text[at - 1] !== '(') return null;
    MENTION.lastIndex = at;
    const match = MENTION.exec(this.text);
    if (!match) return null;
    return { spans: [{ text: match[0], marks: this.with('mention') }], end: at + match[0].length };
  }

  private emphasis(at: number): Token | null {
    for (const delimiter of DELIMITERS) {
      const { marker } = delimiter;
      if (!this.text.startsWith(marker, at) || this.missing.has(marker)) continue;
      if (!canOpen(this.text, at, delimiter)) continue;
      const close = findClose(this.text, at + marker.length + 1, delimiter);
      if (close === -1) {
        this.missing.add(marker);
        continue;
      }
      const inner = this.text.slice(at + marker.length, close);
      return {
        spans: [
          this.marker(marker),
          ...new Scanner(inner, this.with(delimiter.mark)).spans(),
          this.marker(marker),
        ],
        end: close + marker.length,
      };
    }
    let end = at;
    while (this.text[end] === this.text[at]) end += 1;
    return { spans: [{ text: this.text.slice(at, end), marks: this.marks }], end };
  }
}

export function inlineSpans(text: string, marks: readonly Mark[] = []): Span[] {
  return new Scanner(text, marks).spans();
}

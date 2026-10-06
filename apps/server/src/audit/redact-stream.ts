import { redacted, redactText } from './redact.ts';

const ENV_LINE = /^[ \t]*(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_.-]*[ \t]*(?:=|$)/;
const SPANNING_SECRETS = [
  /"[^"\\\n]{1,80}"\s*:\s*(?:"(?:[^"\\]|\\.)*"?)?/g,
  /\bBearer\s+\S*/gi,
  /\bAuthorization:\s*(?:token\s+)?\S*/gi,
];
const MID_LINE = '\u0001';
const KEY_BEGIN = '-----BEGIN ';
const KEY_END = '-----END ';

export interface RedactionFilter {
  push(delta: string): string;
  finish(): string;
  pending(): number;
}

function openKeyBlock(text: string): number {
  const begin = text.lastIndexOf(KEY_BEGIN);
  if (begin === -1) return -1;
  const end = text.indexOf(KEY_END, begin);
  const closed = end !== -1 && text.includes('\n', end);
  return closed ? -1 : begin;
}

function safeEnd(text: string, atLineStart: boolean): number {
  const block = openKeyBlock(text);
  if (block !== -1) return text.lastIndexOf('\n', block) + 1;
  const lineStart = text.lastIndexOf('\n') + 1;
  const line = text.slice(lineStart);
  if ((lineStart > 0 || atLineStart) && ENV_LINE.test(line)) return lineStart;
  return lineStart + unfinishedFrom(line);
}

function unfinishedFrom(line: string): number {
  const spans = SPANNING_SECRETS.flatMap((rule) =>
    [...line.matchAll(rule)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    })),
  );
  let cut = line.search(/\S*$/);
  for (let moved = true; moved;) {
    const reaching = spans.filter((span) => span.start < cut && span.end >= cut);
    moved = reaching.length > 0;
    cut = Math.min(cut, ...reaching.map((span) => span.start));
  }
  return cut;
}

export function redactSecrets(text: string, values: readonly string[]): string {
  const withoutValues = values.reduce(
    (result, value) => result.replaceAll(value, redacted('secret_value')),
    text,
  );
  return redactText(withoutValues);
}

export function createRedactionFilter(values: readonly string[]): RedactionFilter {
  let held = '';
  let atLineStart = true;
  const release = (end: number) => {
    const out = held.slice(0, end);
    held = held.slice(end);
    if (out === '') return '';
    const clean = atLineStart
      ? redactSecrets(out, values)
      : redactSecrets(`${MID_LINE}${out}`, values).slice(MID_LINE.length);
    atLineStart = out.endsWith('\n');
    return clean;
  };
  return {
    push(delta) {
      held += delta;
      return release(safeEnd(held, atLineStart));
    },
    finish: () => release(held.length),
    pending: () => held.length,
  };
}

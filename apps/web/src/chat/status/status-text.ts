import { REDACTED_MARKER, isSensitiveEnvKey, redactText } from '@spark-outpost/contracts';

export const HIDDEN = '•••';
export const COMMAND_CHARS = 44;
const PHRASE_CHARS = 56;
const ELLIPSIS = ' …';

const INLINE_ENV = /\b([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g;
const SECRET_FLAG =
  /(--?(?:token|access-token|password|passwd|secret|client-secret|api-?key|auth)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi;
const LEADING_ENV = /^(?:(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/;
const CHANGE_DIR = /^(?:cd|pushd)(?:\s|$)/;

const HIDDEN_VALUE = `=${HIDDEN}`;
const KEPT_ASSIGNMENT = `\u0000${HIDDEN}`;

export function hideSecrets(text: string): string {
  const flagged = text
    .replace(INLINE_ENV, (match, key: string) =>
      isSensitiveEnvKey(key) ? `${key}${KEPT_ASSIGNMENT}` : match,
    )
    .replace(SECRET_FLAG, (_match, flag: string) => `${flag}${HIDDEN}`);
  return redactText(flagged)
    .replace(REDACTED_MARKER, HIDDEN)
    .replaceAll(KEPT_ASSIGNMENT, HIDDEN_VALUE);
}

function separatorWidth(text: string, index: number): number {
  const pair = text.slice(index, index + 2);
  if (pair === '&&' || pair === '||') return 2;
  const char = text[index];
  return char === ';' || char === '|' || char === '\n' ? 1 : 0;
}

function segments(command: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    const width = separatorWidth(command, index);
    if (width === 0) continue;
    parts.push(command.slice(start, index));
    start = index + width;
    index += width - 1;
  }
  parts.push(command.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

interface Clipped {
  text: string;
  clipped: boolean;
}

function clipWords(text: string, max: number): Clipped {
  if (text.length <= max) return { text, clipped: false };
  const space = text.slice(0, max + 1).lastIndexOf(' ');
  const end = space >= max / 2 ? space : max;
  return {
    text: text
      .slice(0, end)
      .replace(/\s+-+$/, '')
      .trimEnd(),
    clipped: true,
  };
}

export function clipText(text: string, max = PHRASE_CHARS): string {
  const clip = clipWords(text.replace(/\s+/g, ' ').trim(), max);
  return clip.clipped ? `${clip.text}${ELLIPSIS}` : clip.text;
}

export function commandSummary(command: string, max = COMMAND_CHARS): string {
  const parts = segments(command).map((part) => part.replace(LEADING_ENV, '').trim());
  const kept = parts.filter(Boolean);
  const meaningful = kept.findIndex((part) => !CHANGE_DIR.test(part));
  const index = meaningful < 0 ? 0 : meaningful;
  const head = hideSecrets(kept[index] ?? '').replace(/\s+/g, ' ');
  const clip = clipWords(head, max);
  return clip.clipped || index < kept.length - 1 ? `${clip.text}${ELLIPSIS}` : clip.text;
}

export function commandFull(command: string): string {
  return hideSecrets(command.trim());
}

export function fileName(path: string): string {
  const tidy = path.replace(/[\\/]+$/, '');
  return tidy.split(/[\\/]/).filter(Boolean).at(-1) ?? tidy;
}

export function clockText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

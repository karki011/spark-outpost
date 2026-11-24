const UTF8_PREFIX = 'try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}';
const POWERSHELL_EXES = new Set(['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);
const QUIET_FLAGS = new Set(['-noprofile', '-nologo', '-noninteractive']);
const COMMAND_FLAGS = new Set(['-command', '-c']);
const UNSAFE_IN_DOUBLE = /[\\$`!"]/;

interface Word {
  value: string;
  raw: string;
  quoted: boolean;
  end: number;
}

function skipSpaces(text: string, index: number): number {
  while (index < text.length && /\s/.test(text[index]!)) index++;
  return index;
}

function closing(text: string, start: number, quote: string): number {
  const end = text.indexOf(quote, start + 1);
  return end;
}

function readWord(text: string, start: number): Word | null {
  let index = start;
  let value = '';
  let quoted = false;
  while (index < text.length && !/\s/.test(text[index]!)) {
    const char = text[index]!;
    if (char === "'" || char === '"') {
      const end = closing(text, index, char);
      if (end < 0) return null;
      const inner = text.slice(index + 1, end);
      if (char === '"' && UNSAFE_IN_DOUBLE.test(inner)) return null;
      value += inner;
      quoted = true;
      index = end + 1;
      continue;
    }
    if (char === '\\') return null;
    value += char;
    index++;
  }
  return { value, raw: text.slice(start, index), quoted, end: index };
}

function rawWordEnd(text: string, start: number): number {
  let index = start;
  while (index < text.length && !/\s/.test(text[index]!)) {
    const char = text[index]!;
    if (char === "'" || char === '"') {
      const end = closing(text, index, char);
      if (end < 0) return -1;
      index = end + 1;
    } else index++;
  }
  return index;
}

function exeName(raw: string): string {
  const parts = raw.replace(/["']/g, '').split(/[\\/]/);
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

function withoutPrefix(script: string): string {
  const trimmed = script.trimStart();
  if (!trimmed.startsWith(UTF8_PREFIX)) return script;
  return trimmed.slice(UTF8_PREFIX.length).replace(/^\s*;?/, '');
}

function soleWord(text: string): string | null {
  const start = skipSpaces(text, 0);
  const word = readWord(text, start);
  if (!word || skipSpaces(text, word.end) !== text.length) return null;
  return word.value;
}

function remainderScript(remainder: string): string | null {
  const trimmed = remainder.trim();
  if (!trimmed) return null;
  const start = skipSpaces(trimmed, 0);
  const first = rawWordEnd(trimmed, start);
  if (first < 0) return null;
  if (skipSpaces(trimmed, first) === trimmed.length) return soleWord(trimmed);
  return /["']/.test(trimmed) ? null : trimmed;
}

function wrappedScript(command: string, start: number): string | null {
  let index = start;
  for (;;) {
    index = skipSpaces(command, index);
    const word = readWord(command, index);
    if (!word || word.quoted || !word.value) return null;
    const flag = word.value.toLowerCase();
    if (COMMAND_FLAGS.has(flag)) return remainderScript(command.slice(word.end));
    if (flag === '-executionpolicy') {
      const policy = readWord(command, skipSpaces(command, word.end));
      if (!policy || !policy.value) return null;
      index = policy.end;
      continue;
    }
    if (!QUIET_FLAGS.has(flag)) return null;
    index = word.end;
  }
}

function wrapped(command: string, unquoteOnce: boolean): string | null {
  const trimmed = command.trim();
  const firstEnd = rawWordEnd(trimmed, 0);
  if (!trimmed || firstEnd < 0) return null;
  if (POWERSHELL_EXES.has(exeName(trimmed.slice(0, firstEnd)))) {
    const script = wrappedScript(trimmed, firstEnd);
    return script === null ? null : withoutPrefix(script);
  }
  const sole = /^["']/.test(trimmed) && skipSpaces(trimmed, firstEnd) === trimmed.length;
  if (!unquoteOnce || !sole) return null;
  const inner = soleWord(trimmed);
  return inner === null ? null : wrapped(inner, false);
}

export function powershellScript(command: string): string | null {
  return wrapped(command, true);
}

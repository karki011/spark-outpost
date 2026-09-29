const PLAIN = /^[\w@%+=:,./~^-]+$/;
const HOME = /(^|[\s='"])(?:\/Users|\/home)\/[^/\s'"]+(?=[/\s'"]|$)/g;

export type SplitResult = { ok: true; parts: string[] } | { ok: false; error: string };

export function splitCommandLine(line: string): SplitResult {
  const parts: string[] = [];
  let current = '';
  let started = false;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
    } else if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === '\\' && /["\\$`]/.test(line[index + 1] ?? '')) current += line[++index];
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === '\\' && index + 1 < line.length) {
      current += line[++index];
      started = true;
    } else if (/\s/.test(char)) {
      if (started) parts.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) return { ok: false, error: 'Close the quote.' };
  if (started) parts.push(current);
  return { ok: true, parts };
}

export function quoteArg(part: string): string {
  if (PLAIN.test(part)) return part;
  return `'${part.replaceAll("'", `'\\''`)}'`;
}

export function joinCommandLine(parts: readonly string[]): string {
  return parts.map(quoteArg).join(' ');
}

export function shortHome(text: string): string {
  return text.replace(HOME, '$1~');
}

import path from 'node:path';

const MAX_SHAPES = 64;
const SUBSTITUTION = /\$\([^)]*\)|`[^`]*`|\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9@*#?$!-]/g;
const HOME_VARIABLE = /\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g;
const USER_HOME = /^~([A-Za-z0-9._-]+)(?=\/|$)/;
const WILD_ONLY = /^[*?/\s]*$/;

const INNER_SUBSTITUTION = /\$\([^()]*\)|`[^`]*`/g;
const SUBSTITUTED = '$SPARK_SUBSTITUTED';

export function substitutedCommand(command: string): string {
  let current = command;
  for (let round = 0; round < 8; round++) {
    const next = current.replace(INNER_SUBSTITUTION, SUBSTITUTED);
    if (next === current) return current;
    current = next;
  }
  return current;
}

export interface WordShape {
  text: string;
  anywhere: boolean;
}

function topLevelBrace(word: string): { start: number; end: number; parts: string[] } | null {
  for (let start = 0; start < word.length; start++) {
    if (word[start] !== '{' || word[start - 1] === '$') continue;
    let depth = 0;
    let from = start + 1;
    const parts: string[] = [];
    for (let index = start; index < word.length; index++) {
      const char = word[index];
      if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        parts.push(word.slice(from, index));
        if (parts.length > 1) return { start, end: index, parts };
        break;
      } else if (char === ',' && depth === 1) {
        parts.push(word.slice(from, index));
        from = index + 1;
      }
    }
  }
  return null;
}

function rangeWidened(word: string): string {
  return word.replace(/\{[^{},]*\.\.[^{},]*\}/g, '*');
}

export function braceExpansions(word: string): string[] | null {
  const shapes: string[] = [];
  const pending = [rangeWidened(word)];
  while (pending.length > 0) {
    const next = pending.pop()!;
    const brace = topLevelBrace(next);
    if (!brace) {
      shapes.push(next);
    } else {
      const head = next.slice(0, brace.start);
      const tail = next.slice(brace.end + 1);
      pending.push(...brace.parts.map((part) => `${head}${part}${tail}`));
    }
    if (shapes.length + pending.length > MAX_SHAPES) return null;
  }
  return shapes;
}

export function homeExpanded(word: string, home: string): string {
  const withHome = word.replace(HOME_VARIABLE, home);
  if (withHome === '~' || withHome.startsWith('~/')) return path.join(home, withHome.slice(1));
  const user = USER_HOME.exec(withHome);
  if (!user) return withHome;
  return path.join(path.dirname(home), user[1]!, withHome.slice(user[0].length));
}

function shapeOf(word: string, home: string): WordShape | null {
  const expanded = homeExpanded(word, home);
  const leadingUnknown = expanded.search(SUBSTITUTION) === 0;
  const text = expanded.replace(SUBSTITUTION, '**');
  if (text !== expanded && WILD_ONLY.test(text)) return null;
  return leadingUnknown ? { text: `/${text}`, anywhere: true } : { text, anywhere: false };
}

function widenedBraces(word: string): string {
  return word.replace(/\{[^}]*\}/g, '**').replace(/\*{3,}/g, '**');
}

export function wordShapes(word: string, home: string): WordShape[] {
  const expansions = braceExpansions(word) ?? [widenedBraces(word)];
  return expansions.flatMap((expansion) => {
    const shape = shapeOf(expansion, home);
    return shape ? [shape] : [];
  });
}

export interface Peeled {
  outer: string;
  inner: string[];
}

function closingParen(script: string, from: number): number | null {
  let depth = 1;
  let quote: '"' | "'" | null = null;
  for (let index = from; index < script.length; index++) {
    const char = script[index]!;
    if (quote === "'") {
      if (char === "'") quote = null;
    } else if (char === '\\') {
      index++;
    } else if (quote === '"') {
      if (char === '"') quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth++;
    } else if (char === ')' && --depth === 0) {
      return index;
    }
  }
  return null;
}

function closingBacktick(script: string, from: number): number | null {
  for (let index = from; index < script.length; index++) {
    if (script[index] === '\\') index++;
    else if (script[index] === '`') return index;
  }
  return null;
}

export function peelSubstitutions(script: string, placeholder: string): Peeled | null {
  const inner: string[] = [];
  let outer = '';
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < script.length; index++) {
    const char = script[index]!;
    const substitutes = char === '$' && script[index + 1] === '(' && script[index + 2] !== '(';
    if (quote === "'") {
      if (char === "'") quote = null;
      outer += char;
    } else if (char === '\\') {
      outer += char + (script[index + 1] ?? '');
      index++;
    } else if (substitutes || char === '`') {
      const start = index + (substitutes ? 2 : 1);
      const end = substitutes ? closingParen(script, start) : closingBacktick(script, start);
      if (end === null) return null;
      inner.push(script.slice(start, end));
      outer += placeholder;
      index = end;
    } else {
      if (char === '"' || char === "'") quote = quote === char ? null : (quote ?? char);
      outer += char;
    }
  }
  return quote === null ? { outer, inner } : null;
}

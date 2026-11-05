import { splitCommandLine, type SimpleCommand } from './commands.ts';

const DISCARDED_OUTPUT = /(?<=^|[\s;&|])(?:\d*>>?|&>>?)\s*\/dev\/null(?=$|[\s;&|])/g;
const DUPLICATED_OUTPUT = /(?<=^|[\s;&|])\d*>&\d+(?=$|[\s;&|])/g;
const UNSAFE_OPERATOR = /[<>()]|(?<!&)&(?!&)/;

interface Masked {
  text: string;
  expands: boolean;
}

function maskQuoted(command: string): Masked | null {
  let text = '';
  let quote: '"' | "'" | null = null;
  let expands = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (quote === "'") {
      if (char === "'") quote = null;
      text += ' ';
    } else if (char === '\\') {
      if (index + 1 < command.length) index++;
      text += '  ';
    } else if (char === '$' || char === '`') {
      expands = true;
      text += char;
    } else if (quote === '"') {
      if (char === '"') quote = null;
      text += ' ';
    } else if (char === '"' || char === "'") {
      quote = char;
      text += ' ';
    } else {
      text += char;
    }
  }
  return quote === null ? { text, expands } : null;
}

function blank(text: string, pattern: RegExp): string {
  return text.replace(pattern, (match) => ' '.repeat(match.length));
}

export function readPipeline(command: string): SimpleCommand[] | null {
  const masked = maskQuoted(command);
  if (!masked || masked.expands) return null;
  const kept = blank(blank(masked.text, DISCARDED_OUTPUT), DUPLICATED_OUTPUT);
  if (UNSAFE_OPERATOR.test(kept)) return null;
  let plain = '';
  for (let index = 0; index < command.length; index++) {
    plain += kept[index] === ' ' && masked.text[index] !== ' ' ? ' ' : command[index];
  }
  const commands = splitCommandLine(plain);
  if (commands.some((simple) => simple.fragment || simple.stdin === 'group')) return null;
  return commands.length > 0 ? commands : null;
}

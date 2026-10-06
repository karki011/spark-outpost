export interface ShellStatementWord {
  raw: string;
  start: number;
  end: number;
}

export interface ShellStatement {
  words: ShellStatementWord[];
  depth: number;
  plain: boolean;
  after: string;
  endedBy: string;
  end: number;
}

export interface VariableUse {
  name: string;
  start: number;
  end: number;
  plain: boolean;
}

export interface ScannedShell {
  statements: ShellStatement[];
  uses: VariableUse[];
}

export type Span = readonly [start: number, end: number];

const USE = /^\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})/;
const MODIFIED_USE = /^[[:(]/;
const TERMINATORS = new Set([';', '\n', '|', '&', '(', ')', '`']);

class Scan {
  readonly statements: ShellStatement[] = [];
  readonly uses: VariableUse[] = [];
  private words: ShellStatementWord[] = [];
  private wordStart = -1;
  private plain = true;
  private depth = 0;
  private after = '';
  private inBackticks = false;

  constructor(private readonly command: string) {}

  grow(index: number): void {
    if (this.wordStart === -1) this.wordStart = index;
  }

  get inWord(): boolean {
    return this.wordStart !== -1;
  }

  endWord(index: number): void {
    if (this.wordStart === -1) return;
    const raw = this.command.slice(this.wordStart, index);
    this.words.push({ raw, start: this.wordStart, end: index });
    this.wordStart = -1;
  }

  redirect(index: number): void {
    this.endWord(index);
    this.plain = false;
  }

  endStatement(index: number, operator: string): void {
    this.endWord(index);
    if (this.words.length > 0) {
      this.statements.push({
        words: this.words,
        depth: this.depth,
        plain: this.plain,
        after: this.after,
        endedBy: operator,
        end: index,
      });
    }
    this.words = [];
    this.plain = true;
    this.after = operator;
    if (operator === '(') this.depth += 1;
    if (operator === ')') this.depth = Math.max(0, this.depth - 1);
    if (operator === '`') {
      this.depth = Math.max(0, this.depth + (this.inBackticks ? -1 : 1));
      this.inBackticks = !this.inBackticks;
    }
  }

  use(index: number): number {
    const match = USE.exec(this.command.slice(index, index + 256));
    if (!match) return 0;
    const end = index + match[0].length;
    const bare = match[1] !== undefined;
    const plain = !(bare && MODIFIED_USE.test(this.command.slice(end, end + 1)));
    this.uses.push({ name: match[1] ?? match[2]!, start: index, end, plain });
    return match[0].length;
  }
}

function operatorAt(command: string, index: number): string | null {
  const char = command[index]!;
  if (!TERMINATORS.has(char)) return null;
  const doubled = (char === '&' || char === '|' || char === ';') && command[index + 1] === char;
  return doubled ? char + char : char;
}

function redirectsAt(command: string, index: number): boolean {
  const char = command[index]!;
  if (char === '<' || char === '>') return true;
  if (char !== '&') return false;
  const before = command[index - 1];
  return before === '>' || before === '<' || command[index + 1] === '>';
}

export function shellStatements(command: string, opaque: readonly Span[]): ScannedShell | null {
  const scan = new Scan(command);
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < command.length; index++) {
    const span = quote === null ? opaque.find(([start]) => start === index) : undefined;
    if (span) {
      scan.endStatement(index, '\n');
      index = span[1] - 1;
      continue;
    }
    const char = command[index]!;
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '\\') {
      scan.grow(index);
      index += 1;
      continue;
    }
    if (char === '$') {
      scan.grow(index);
      const used = scan.use(index);
      index += Math.max(0, used - 1);
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === '`') return null;
      continue;
    }
    if (char === '"' || char === "'") {
      scan.grow(index);
      quote = char;
    } else if (char === '#' && !scan.inWord) {
      const lineEnd = command.indexOf('\n', index);
      index = (lineEnd === -1 ? command.length : lineEnd) - 1;
    } else if (redirectsAt(command, index)) {
      scan.redirect(index);
    } else if (operatorAt(command, index) !== null) {
      const operator = operatorAt(command, index)!;
      scan.endStatement(index, operator === ';;' ? ';' : operator);
      index += operator.length - 1;
    } else if (/\s/.test(char)) {
      scan.endWord(index);
    } else {
      scan.grow(index);
    }
  }
  if (quote !== null) return null;
  scan.endStatement(command.length, '');
  return scan;
}

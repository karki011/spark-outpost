import { namedFiles } from './context.ts';

export interface StepFiles {
  changes: string[];
  reads: string[];
}

const FILES_LINE = /(?:^|[\s(;.,-])files\s*:\s*([^\n]+?)\s*[.)]?\s*$/im;
const CHANGE_VERB =
  /(?:^|\s)(?:create|add|edit|update|modify|move|rename|delete|remove|write|split|change|fix|implement|replace|extract|rewrite|overwrite|append|insert|migrate|convert)(?:s|es|d|ed|ing)?(?=\s|$|[,.:;])/i;
const READ_CUES = new Set([
  'from',
  'using',
  'uses',
  'use',
  'see',
  'read',
  'reads',
  'reading',
  'like',
  'import',
  'imports',
  'importing',
  'call',
  'calls',
  'via',
  'per',
  'following',
  'mirror',
  'mirrors',
]);
const TAKES_OUT = /\b(?:move|remove|delete|extract|split|cut|pull)(?:s|es|d|ed|ing)?\b/i;
const CLAUSE_BREAK = /[;\n]|\.\s/;
const CUE_WORDS = 4;

function cleaned(file: string): string {
  return file.replace(/^\.\//, '');
}

function listed(step: string): string[] | null {
  const line = FILES_LINE.exec(step)?.[1];
  if (!line) return null;
  if (/^(?:none|nothing|-)\.?$/i.test(line.trim())) return [];
  return namedFiles([line.replace(/,/g, ' ')]).map(cleaned);
}

function clauseAround(text: string, at: number): { before: string; clause: string } {
  const start = Math.max(
    ...[...text.slice(0, at).matchAll(new RegExp(CLAUSE_BREAK, 'g'))].map(
      (match) => match.index + match[0].length,
    ),
    0,
  );
  const rest = text.slice(at);
  const end = rest.search(CLAUSE_BREAK);
  return {
    before: text.slice(start, at),
    clause: text.slice(start, end === -1 ? text.length : at + end),
  };
}

function readMention(before: string, clause: string): boolean {
  const lastWords = before
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .slice(-CUE_WORDS)
    .map((word) => word.replace(/[^a-z]/g, ''));
  const cue = lastWords.find((word) => READ_CUES.has(word));
  if (!cue) return !CHANGE_VERB.test(clause);
  return cue === 'from' && TAKES_OUT.test(clause) ? false : true;
}

function mentions(step: string): { file: string; changed: boolean }[] {
  const found: { file: string; changed: boolean }[] = [];
  for (const file of namedFiles([step])) {
    let at = step.indexOf(file);
    let changed = false;
    while (at !== -1 && !changed) {
      const { before, clause } = clauseAround(step, at);
      changed = !readMention(before, clause);
      at = step.indexOf(file, at + file.length);
    }
    found.push({ file: cleaned(file), changed });
  }
  return found;
}

export function stepFiles(step: string): StepFiles {
  const withoutList = step.replace(FILES_LINE, '');
  const named = mentions(withoutList);
  const changes = listed(step) ?? named.filter((entry) => entry.changed).map((entry) => entry.file);
  const reads = named
    .map((entry) => entry.file)
    .filter((file) => !changes.some((changed) => sameFile(changed, file)));
  return { changes: [...new Set(changes)], reads: [...new Set(reads)] };
}

function baseName(file: string): string {
  return file.split('/').at(-1) ?? file;
}

export function sameFile(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.includes('/') && b.includes('/')) return false;
  return baseName(a) === baseName(b);
}

function meets(left: readonly string[], right: readonly string[]): boolean {
  return left.some((file) => right.some((other) => sameFile(file, other)));
}

export function dependsOn(first: StepFiles, second: StepFiles): boolean {
  return (
    meets(first.changes, second.changes) ||
    meets(first.changes, second.reads) ||
    meets(first.reads, second.changes)
  );
}

export function changedCount(step: string): number {
  return stepFiles(step).changes.length;
}

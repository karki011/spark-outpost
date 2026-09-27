export interface RequestTerms {
  paths: string[];
  fileNames: string[];
  identifiers: string[];
  phrases: string[];
}

export const MAX_IDENTIFIERS = 12;
export const MAX_PATHS = 8;
export const MAX_PHRASES = 4;

const QUOTED = /`([^`\n]{2,120})`|"([^"\n]{2,80})"|'([^'\n]{2,80})'|“([^”\n]{2,80})”/g;
const PATH = /(?:^|[\s(`'"])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.[\]-]+)+\/?)/g;
const FILE_NAME =
  /\b[\w.-]*\w\.(?:[jt]sx?|mjs|cjs|py|go|rs|java|cs|cpp|cc|h|hpp|rb|php|sh|css|scss|json|ya?ml|toml|md|sql|html|vue|svelte)\b/g;
const CAMEL = /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b/g;
const PASCAL = /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g;
const SNAKE = /\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g;
const SCREAMING = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const KEBAB = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g;
const SINGLE_PASCAL = /(?<=[a-z,:;]\s+(?:the\s+|a\s+|an\s+)?)\b[A-Z][a-z0-9]{3,}\b/g;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const IS_FILE_NAME = new RegExp(`^${FILE_NAME.source}$`);

const COMMON_WORDS = new Set([
  'this',
  'that',
  'then',
  'when',
  'with',
  'from',
  'into',
  'also',
  'make',
  'sure',
  'please',
  'should',
  'would',
  'could',
  'there',
  'these',
  'those',
  'after',
  'before',
]);

const KEBAB_STOPWORDS =
  /^(?:e-mail|re-\w+|pre-\w+|non-\w+|co-\w+|well-\w+|up-to-date|built-in|end-to-end)$/;

function add(list: string[], value: string, limit: number): void {
  if (value.length < 3 || list.includes(value) || list.length >= limit) return;
  list.push(value);
}

function matchesOf(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1] ?? match[0]);
}

function quotedTerms(text: string, terms: RequestTerms): void {
  for (const match of text.matchAll(QUOTED)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (value.includes('/')) add(terms.paths, value.replace(/^\.\//, ''), MAX_PATHS);
    else if (IS_FILE_NAME.test(value)) add(terms.fileNames, value, MAX_PATHS);
    else if (IDENTIFIER.test(value)) add(terms.identifiers, value, MAX_IDENTIFIERS);
    else if (/\s/.test(value) && value.length <= 60) add(terms.phrases, value, MAX_PHRASES);
  }
}

function pathTerms(text: string, terms: RequestTerms): void {
  for (const path of matchesOf(text, PATH)) {
    const clean = path.replace(/^\.\//, '').replace(/[.,;:]+$/, '');
    if (/^https?:/.test(clean) || clean.startsWith('//')) continue;
    add(terms.paths, clean, MAX_PATHS);
  }
  for (const name of matchesOf(text, FILE_NAME)) {
    if (!terms.paths.some((path) => path.endsWith(name))) add(terms.fileNames, name, MAX_PATHS);
  }
}

function identifierTerms(text: string, terms: RequestTerms): void {
  const stripped = text.replace(PATH, ' ').replace(FILE_NAME, ' ');
  const found = [CAMEL, PASCAL, SCREAMING, SNAKE, KEBAB, SINGLE_PASCAL].flatMap((pattern) =>
    [...stripped.matchAll(pattern)].map((match) => ({ value: match[0], at: match.index })),
  );
  found.sort((a, b) => a.at - b.at);
  for (const { value } of found) {
    if (COMMON_WORDS.has(value.toLowerCase()) || KEBAB_STOPWORDS.test(value)) continue;
    add(terms.identifiers, value, MAX_IDENTIFIERS);
  }
}

export function extractTerms(request: string): RequestTerms {
  const terms: RequestTerms = { paths: [], fileNames: [], identifiers: [], phrases: [] };
  quotedTerms(request, terms);
  pathTerms(request, terms);
  identifierTerms(request, terms);
  return terms;
}

function words(term: string): string[] {
  return term
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function nameVariants(term: string): string[] {
  const parts = words(term);
  if (parts.length < 2) return [term];
  const pascal = parts.map(capitalise).join('');
  const camel = (parts[0] ?? '') + parts.slice(1).map(capitalise).join('');
  return [...new Set([term, pascal, camel, parts.join('_'), parts.join('-')])];
}

export function searchPatterns(terms: RequestTerms): string[] {
  const names = terms.identifiers.flatMap((term) =>
    term.includes('-') || term.includes('_') ? nameVariants(term) : [term],
  );
  const files = terms.fileNames.flatMap((name) => {
    const stem = name.slice(0, name.lastIndexOf('.'));
    return stem.length >= 4 ? [name, `/${stem}`] : [name];
  });
  return [...new Set([...names, ...files, ...terms.phrases])];
}

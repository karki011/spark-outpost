const PULL_READS: Readonly<Record<string, ReadonlySet<string>>> = {
  pr: new Set(['view', 'checks', 'status', 'diff', 'list']),
  run: new Set(['view', 'list', 'watch']),
};
const OTHER_READS: Readonly<Record<string, ReadonlySet<string>>> = {
  issue: new Set(['view', 'list', 'status']),
  repo: new Set(['view']),
  release: new Set(['view', 'list']),
};
const API_SHORT_VALUE_FLAGS = 'XfFHqtp';
const API_VALUE_FLAGS = new Set([
  ...['-X', '--method', '-f', '-F', '--field', '--raw-field', '-H', '--header', '--input'],
  ...['-q', '--jq', '-t', '--template', '--cache', '-p', '--preview'],
]);
export const API_FIELD_FLAGS: ReadonlySet<string> = new Set(['-f', '-F', '--field', '--raw-field']);
const API_BODY_FLAGS = new Set([...API_FIELD_FLAGS, '--input']);
const QUERY_FIELD = 'query=';
const SHOWS_TOKEN = /^(?:--show-token$|-[a-zA-Z]*t)/;

export function flagName(token: string): string {
  return token.split('=')[0]!;
}

export function flagValues(args: readonly string[], flags: ReadonlySet<string>): string[] {
  return args.flatMap((token, index) => {
    if (!flags.has(flagName(token))) return [];
    const inline = token.indexOf('=');
    return [inline === -1 ? (args[index + 1] ?? '') : token.slice(inline + 1)];
  });
}

function spreadShortFlags(token: string): string[] {
  if (!/^-[a-zA-Z]{2}/.test(token)) return [token];
  const at = [...token].findIndex(
    (letter, index) => index > 0 && API_SHORT_VALUE_FLAGS.includes(letter),
  );
  if (at === -1) return [token];
  const before = at > 1 ? [`-${token.slice(1, at)}`] : [];
  const value = token.slice(at + 1).replace(/^=/, '');
  return [...before, `-${token[at]}`, ...(value ? [value] : [])];
}

export function apiWords(args: readonly string[]): string[] {
  return args.flatMap(spreadShortFlags);
}

export function apiEndpoint(words: readonly string[]): string | null {
  const found = words.find((token, index) => {
    if (token.startsWith('-')) return false;
    const previous = words[index - 1];
    return !previous || !API_VALUE_FLAGS.has(previous);
  });
  return found ?? null;
}

export function apiMethod(words: readonly string[]): string {
  const named = flagValues(words, new Set(['-X', '--method']))[0];
  if (named) return named.toUpperCase();
  return words.some((token) => API_BODY_FLAGS.has(flagName(token))) ? 'POST' : 'GET';
}

function provenQuery(words: readonly string[]): boolean {
  if (words.some((token) => flagName(token) === '--input')) return false;
  const fields = flagValues(words, API_FIELD_FLAGS);
  const queries = fields.filter((field) => field.startsWith(QUERY_FIELD));
  if (queries.length !== 1) return false;
  const text = queries[0]!.slice(QUERY_FIELD.length).trim();
  return /^(?:query\b|\{)/.test(text) && !/\bmutation\b/.test(fields.join('\n'));
}

function apiReads(args: readonly string[]): boolean {
  const words = apiWords(args);
  const endpoint = apiEndpoint(words);
  if (!endpoint) return false;
  return endpoint === 'graphql' ? provenQuery(words) : apiMethod(words) === 'GET';
}

export function ghPullRead(group: string, verb: string): boolean {
  return PULL_READS[group]?.has(verb) ?? false;
}

export function ghOnlyReads(args: readonly string[]): boolean {
  const [group, verb, ...rest] = args;
  if (!group) return false;
  if (group === 'api') return apiReads(args.slice(1));
  if (!verb || verb.startsWith('-')) return false;
  if (group === 'search') return true;
  if (group === 'auth') return verb === 'status' && !rest.some((token) => SHOWS_TOKEN.test(token));
  return ghPullRead(group, verb) || (OTHER_READS[group]?.has(verb) ?? false);
}

export function ghSendsQuery(args: readonly string[]): boolean {
  return args[0] === 'search';
}

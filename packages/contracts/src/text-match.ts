const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'do',
  'does',
  'to',
  'of',
  'in',
  'on',
  'for',
  'and',
  'or',
  'what',
  'how',
  'i',
  'my',
  'can',
  'it',
]);

export function searchTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

export function tokenMatches(queryToken: string, candidate: string): boolean {
  if (candidate === queryToken) return true;
  if (stem(candidate) === stem(queryToken)) return true;
  if (queryToken.length >= 4 && candidate.startsWith(queryToken)) return true;
  if (candidate.length >= 4 && queryToken.startsWith(candidate)) return true;
  return false;
}

export function prefixMatches(queryToken: string, candidate: string): boolean {
  return stem(candidate) === stem(queryToken) || candidate.startsWith(queryToken);
}

export function countTokenMatches(
  queryToken: string,
  tokens: readonly string[],
  matches: (queryToken: string, candidate: string) => boolean = tokenMatches,
): number {
  let count = 0;
  for (const token of tokens) {
    if (matches(queryToken, token)) count += 1;
  }
  return count;
}

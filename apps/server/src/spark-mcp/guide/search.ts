import type { GuideSection } from './sections.ts';

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

function tokenize(text: string): string[] {
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

function tokenMatches(queryToken: string, candidate: string): boolean {
  if (candidate === queryToken) return true;
  if (stem(candidate) === stem(queryToken)) return true;
  if (queryToken.length >= 4 && candidate.startsWith(queryToken)) return true;
  if (candidate.length >= 4 && queryToken.startsWith(candidate)) return true;
  return false;
}

function countMatches(queryToken: string, haystackTokens: string[]): number {
  let count = 0;
  for (const token of haystackTokens) {
    if (tokenMatches(queryToken, token)) count += 1;
  }
  return count;
}

function scoreSection(queryTokens: string[], section: GuideSection): number {
  const titleTokens = tokenize(section.title);
  const keywordTokens = section.keywords.flatMap(tokenize);
  const textTokens = tokenize(section.text);
  let score = 0;
  for (const queryToken of queryTokens) {
    score += countMatches(queryToken, titleTokens) * 3;
    score += countMatches(queryToken, keywordTokens) * 2;
    score += countMatches(queryToken, textTokens) * 1;
  }
  return score;
}

export interface GuideSearchResult {
  id: string;
  title: string;
  score: number;
}

export function searchGuide(
  sections: readonly GuideSection[],
  query: string | undefined,
  limit: number,
): GuideSearchResult[] {
  const queryTokens = tokenize(query ?? '');
  if (queryTokens.length === 0) {
    return sections.map((section) => ({ id: section.id, title: section.title, score: 0 }));
  }
  return sections
    .map((section) => ({
      id: section.id,
      title: section.title,
      score: scoreSection(queryTokens, section),
    }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

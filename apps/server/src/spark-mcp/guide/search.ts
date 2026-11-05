import { countTokenMatches, searchTokens } from '@spark-outpost/contracts';
import type { GuideSection } from './sections.ts';

function scoreSection(queryTokens: string[], section: GuideSection): number {
  const titleTokens = searchTokens(section.title);
  const keywordTokens = section.keywords.flatMap((keyword) => searchTokens(keyword));
  const textTokens = searchTokens(section.text);
  let score = 0;
  for (const queryToken of queryTokens) {
    score += countTokenMatches(queryToken, titleTokens) * 3;
    score += countTokenMatches(queryToken, keywordTokens) * 2;
    score += countTokenMatches(queryToken, textTokens) * 1;
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
  const queryTokens = searchTokens(query ?? '');
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

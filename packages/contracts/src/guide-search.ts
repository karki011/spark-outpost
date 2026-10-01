import { HEADING_LINE, inlineText, markdownLines, type GuidePage } from './guide.ts';
import { countTokenMatches, prefixMatches, searchTokens } from './text-match.ts';

export interface GuideChunk {
  heading: string | null;
  anchor: string | null;
  text: string;
}

export interface GuideSearchHit {
  slug: string;
  title: string;
  section: string;
  heading: string | null;
  anchor: string | null;
  snippet: string;
  score: number;
}

const SNIPPET_CHARS = 160;
const WEIGHTS = { title: 6, summary: 3, heading: 4, text: 1 } as const;

function plainLine(line: string): string {
  return inlineText(
    line
      .replace(/^\s*>\s?/, '')
      .replace(/^\s*([-*+]|\d+\.)\s+/, '')
      .replace(/\|/g, ' '),
  );
}

export function guideChunks(page: GuidePage): GuideChunk[] {
  const chunks: GuideChunk[] = [{ heading: null, anchor: null, text: '' }];
  let index = 0;
  for (const { line, code } of markdownLines(page.body)) {
    const heading = code || !HEADING_LINE.test(line) ? null : page.headings[index];
    if (heading) {
      chunks.push({ heading: heading.text, anchor: heading.anchor, text: '' });
      index += 1;
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) continue;
    const text = code ? line : plainLine(line);
    if (!text.trim() || /^[-:\s]+$/.test(text)) continue;
    const current = chunks[chunks.length - 1]!;
    current.text = current.text ? `${current.text} ${text.trim()}` : text.trim();
  }
  return chunks.filter((chunk) => chunk.heading !== null || chunk.text);
}

function score(queryTokens: string[], text: string, weight: number): number {
  const tokens = searchTokens(text);
  return queryTokens.reduce(
    (sum, queryToken) => sum + countTokenMatches(queryToken, tokens, prefixMatches) * weight,
    0,
  );
}

function chunkScore(queryTokens: string[], chunk: GuideChunk): number {
  return (
    score(queryTokens, chunk.heading ?? '', WEIGHTS.heading) +
    score(queryTokens, chunk.text, WEIGHTS.text)
  );
}

function snippet(text: string, queryTokens: string[]): string {
  const words = text.split(/\s+/);
  const hit = words.findIndex((word) =>
    searchTokens(word).some((token) => queryTokens.some((query) => prefixMatches(query, token))),
  );
  let start = 0;
  if (hit > 6) start = hit - 6;
  let result = words.slice(start).join(' ');
  if (result.length > SNIPPET_CHARS) result = `${result.slice(0, SNIPPET_CHARS).trimEnd()}…`;
  return start > 0 ? `…${result}` : result;
}

function pageHit(queryTokens: string[], page: GuidePage): GuideSearchHit | null {
  const chunks = guideChunks(page);
  const scored = chunks.map((chunk) => ({ chunk, score: chunkScore(queryTokens, chunk) }));
  const best = scored.reduce<(typeof scored)[number] | null>(
    (top, entry) => (entry.score > (top?.score ?? 0) ? entry : top),
    null,
  );
  const total =
    score(queryTokens, page.title, WEIGHTS.title) +
    score(queryTokens, page.summary, WEIGHTS.summary) +
    scored.reduce((sum, entry) => sum + entry.score, 0);
  if (total === 0) return null;
  const target = best?.chunk ?? null;
  const text = target?.text || page.summary;
  return {
    slug: page.slug,
    title: page.title,
    section: page.section,
    heading: target?.heading ?? null,
    anchor: target?.anchor ?? null,
    snippet: snippet(text, queryTokens),
    score: total,
  };
}

export function searchGuidePages(
  pages: readonly GuidePage[],
  query: string,
  limit = 8,
): GuideSearchHit[] {
  const queryTokens = searchTokens(query);
  if (queryTokens.length === 0) return [];
  return pages
    .map((page) => pageHit(queryTokens, page))
    .filter((hit): hit is GuideSearchHit => hit !== null)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}

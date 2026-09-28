import {
  DIGEST_DRAFT_MAX_LENGTH,
  DIGEST_HEADLINE_MAX_LENGTH,
  DIGEST_LINE_MAX_LENGTH,
  DIGEST_LINES_MAX,
  DIGEST_REASON_MAX_LENGTH,
  DIGEST_SUGGESTIONS_MAX,
  digestReplySchema,
  type DigestBody,
  type DigestLine,
  type DigestStats,
  type DigestSuggestion,
} from '@spark-outpost/contracts';
import { fallbackHeadline } from './stats.ts';
import { ellipsize, oneLine } from './text.ts';

function clip(text: string, max: number): string {
  return ellipsize(oneLine(text), max);
}

function headlineOf(raw: string | undefined, stats: DigestStats): string {
  const clean = oneLine(raw ?? '');
  if (clean.length > 0 && clean.length <= DIGEST_HEADLINE_MAX_LENGTH) return clean;
  return fallbackHeadline(stats);
}

function jsonPart(text: string): string | null {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  return start >= 0 && end > start ? unfenced.slice(start, end + 1) : null;
}

function structured(
  text: string,
  chatIds: ReadonlySet<string>,
  stats: DigestStats,
): DigestBody | null {
  const json = jsonPart(text);
  if (!json) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const reply = digestReplySchema.safeParse(value);
  if (!reply.success) return null;
  const lines = reply.data.lines
    .map((line): DigestLine => ({
      text: clip(line.text, DIGEST_LINE_MAX_LENGTH),
      chatId: line.chatId && chatIds.has(line.chatId) ? line.chatId : null,
    }))
    .filter((line) => line.text.length > 0)
    .slice(0, DIGEST_LINES_MAX);
  if (lines.length === 0) return null;
  const suggestions: DigestSuggestion[] = [];
  for (const suggestion of reply.data.suggestions) {
    const reason = clip(suggestion.reason, DIGEST_REASON_MAX_LENGTH);
    const draft = clip(suggestion.draft, DIGEST_DRAFT_MAX_LENGTH);
    const repeated = suggestions.some((kept) => kept.chatId === suggestion.chatId);
    if (!chatIds.has(suggestion.chatId) || repeated || !reason || !draft) continue;
    if (suggestions.length < DIGEST_SUGGESTIONS_MAX) {
      suggestions.push({ chatId: suggestion.chatId, reason, draft });
    }
  }
  return { headline: headlineOf(reply.data.headline, stats), lines, suggestions, structured: true };
}

function bullets(text: string, stats: DigestStats): DigestBody {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0 && !/^[{}[\]]/.test(line))
    .slice(0, DIGEST_LINES_MAX)
    .map((line): DigestLine => ({ text: clip(line, DIGEST_LINE_MAX_LENGTH), chatId: null }));
  return { headline: fallbackHeadline(stats), lines, suggestions: [], structured: false };
}

export function parseDigestReply(
  text: string,
  chatIds: ReadonlySet<string>,
  stats: DigestStats,
): DigestBody {
  return structured(text, chatIds, stats) ?? bullets(text, stats);
}

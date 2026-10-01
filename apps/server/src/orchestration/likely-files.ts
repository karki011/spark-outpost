import { ORCHESTRATION_JEV_TIMEOUT_MS } from './jev-calls.ts';
import type { Ranking } from './observe-rank.ts';
import type { Session } from './session.ts';

export const LIKELY_HINTS = 8;
export const RANKING_WAIT_MS = ORCHESTRATION_JEV_TIMEOUT_MS + 1_000;

export async function awaitRanking(
  s: Pick<Session, 'ranking'>,
  waitMs: number = RANKING_WAIT_MS,
): Promise<Ranking | null> {
  if (!s.ranking) return null;
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  try {
    return await Promise.race([s.ranking, late]);
  } finally {
    clearTimeout(timer);
  }
}

export function likelyFilesLine(
  ranking: Ranking | null,
  relevant: (path: string) => boolean = () => true,
): string | null {
  if (!ranking) return null;
  const shown = ranking.predicted
    .filter((path) => ranking.probabilities.has(path) && relevant(path))
    .slice(0, LIKELY_HINTS);
  if (shown.length === 0) return null;
  const files = shown.map((path) => `${path} (${ranking.probabilities.get(path)!.toFixed(2)})`);
  return `Likely files (a ranking hint, not a limit): ${files.join(', ')}`;
}

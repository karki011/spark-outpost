import type { AtK } from '../../apps/server/src/routing/labels.ts';

export interface ContentRankSample {
  current: AtK;
  scan: AtK;
  content: AtK;
  tokens: number | null;
  filesSent: number;
  filesCached: number;
  buildMs: number | null;
}

export interface ContentRankLabel {
  files: { scan: AtK; predicted: AtK; content: AtK | null } | null;
  contentRank: {
    tokens: number | null;
    filesSent: number;
    filesCached: number;
    buildMs: number | null;
  } | null;
}

export interface ContentRankSummary {
  turns: number;
  scan: { precision: number | null; recall: number | null };
  current: { precision: number | null; recall: number | null };
  content: { precision: number | null; recall: number | null };
  better: number;
  worse: number;
  same: number;
  tokensPerTurn: number | null;
  cachedShare: number | null;
  buildMsMedian: number | null;
}

export const PROMOTE_MIN_TURNS = 50;
export const PROMOTE_RECALL_GAIN = 0.05;

export function comparable(labels: readonly ContentRankLabel[]): ContentRankSample[] {
  return labels.flatMap((label) => {
    const content = label.files?.content;
    if (!label.files || !content || content.recall === null) return [];
    return [
      {
        current: label.files.predicted,
        scan: label.files.scan,
        content,
        tokens: label.contentRank?.tokens ?? null,
        filesSent: label.contentRank?.filesSent ?? 0,
        filesCached: label.contentRank?.filesCached ?? 0,
        buildMs: label.contentRank?.buildMs ?? null,
      },
    ];
  });
}

function mean(values: readonly (number | null)[]): number | null {
  const known = values.filter((value) => value !== null);
  return known.length > 0 ? known.reduce((total, value) => total + value, 0) / known.length : null;
}

function median(values: readonly (number | null)[]): number | null {
  const known = values.filter((value) => value !== null).sort((a, b) => a - b);
  return known.length > 0 ? known[Math.floor(known.length / 2)]! : null;
}

function averages(rows: readonly AtK[]) {
  return {
    precision: mean(rows.map((row) => row.precision)),
    recall: mean(rows.map((row) => row.recall)),
  };
}

export function summarise(samples: readonly ContentRankSample[]): ContentRankSummary {
  const files = samples.reduce((total, sample) => total + sample.filesSent, 0);
  const cached = samples.reduce((total, sample) => total + sample.filesCached, 0);
  return {
    turns: samples.length,
    scan: averages(samples.map((sample) => sample.scan)),
    current: averages(samples.map((sample) => sample.current)),
    content: averages(samples.map((sample) => sample.content)),
    better: samples.filter((sample) => sample.content.hits > sample.current.hits).length,
    worse: samples.filter((sample) => sample.content.hits < sample.current.hits).length,
    same: samples.filter((sample) => sample.content.hits === sample.current.hits).length,
    tokensPerTurn: mean(samples.map((sample) => sample.tokens)),
    cachedShare: files + cached > 0 ? cached / (files + cached) : null,
    buildMsMedian: median(samples.map((sample) => sample.buildMs)),
  };
}

export function verdict(summary: ContentRankSummary): string {
  if (summary.turns < PROMOTE_MIN_TURNS) {
    return `Keep observing: ${summary.turns} labelled turns, ${PROMOTE_MIN_TURNS} needed.`;
  }
  const gain = (summary.content.recall ?? 0) - (summary.current.recall ?? 0);
  const precisionHolds = (summary.content.precision ?? 0) >= (summary.current.precision ?? 0);
  if (gain >= PROMOTE_RECALL_GAIN && precisionHolds && summary.better > summary.worse) {
    return 'Supports promotion: recall@5 is up by at least 0.05, precision@5 is not lower, and more turns improved than got worse.';
  }
  return 'Does not support promotion yet.';
}

const share = (value: number | null) => (value === null ? '—' : value.toFixed(2));

export function renderContentRank(summary: ContentRankSummary): string {
  const row = (name: string, at: { precision: number | null; recall: number | null }) =>
    `${name.padEnd(22)} ${share(at.precision).padEnd(12)} ${share(at.recall)}`;
  return [
    `Content-based file ranking, observed: ${summary.turns} turns with a content ranking and known changed files`,
    'ranking                precision@5  recall@5',
    row('scan order', summary.scan),
    row('current (agents get)', summary.current),
    row('content (Jev previews)', summary.content),
    `Per turn, content against current: ${summary.better} better, ${summary.worse} worse, ${summary.same} the same (by hits in the top 5)`,
    `Jev input tokens per turn: ${summary.tokensPerTurn === null ? '—' : Math.round(summary.tokensPerTurn)}; files answered from the cache: ${share(summary.cachedShare)}; preview build, median ms: ${summary.buildMsMedian ?? '—'}`,
    verdict(summary),
  ].join('\n');
}

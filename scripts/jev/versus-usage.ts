import { optionKeys, type Question } from './versus-ask.ts';
import { fixed, percent, table, whole } from './versus-format.ts';
import type { Item } from './versus-items.ts';
import type { Reading } from './versus-report.ts';
import type { ResultRow } from './versus-run.ts';
import { percentile, recallAt } from './versus-score.ts';

const MASS_SLACK = 0.05;
const SPARK_TURN_LINE_MS = 3_000;
const JEV_CLIENT_LINE_MS = 10_000;

export function latencyTable(
  items: readonly Item[],
  rows: readonly ResultRow[],
  variants: readonly string[],
): string {
  const useOf = new Map(items.map((item) => [item.id, item.use]));
  const uses = [...new Set(items.map((item) => item.use))].sort();
  const body: string[][] = [];
  for (const use of [...uses, 'ALL']) {
    for (const variant of variants) {
      const calls = rows.filter(
        (row) => row.variant === variant && (use === 'ALL' || useOf.get(row.item) === use),
      );
      if (calls.length === 0) continue;
      const walls = calls.map((row) => row.wallMs);
      const api = calls.flatMap((row) => (row.apiMs === null ? [] : [row.apiMs]));
      const serving = api.length > 0 ? api : walls;
      const tokens = calls.flatMap((row) => (row.inputTokens === null ? [] : [row.inputTokens]));
      const output = calls.flatMap((row) => (row.outputTokens === null ? [] : [row.outputTokens]));
      const cost = calls.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
      const mean = (values: readonly number[]) =>
        values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
      const over = (line: number) =>
        serving.filter((value) => value > line).length / serving.length;
      body.push([
        use,
        variant,
        String(calls.length),
        String(calls.filter((row) => !row.ok).length),
        `${whole(percentile(walls, 0.5))} / ${whole(percentile(walls, 0.95))}`,
        api.length > 0 ? `${whole(percentile(api, 0.5))} / ${whole(percentile(api, 0.95))}` : '—',
        percent(over(SPARK_TURN_LINE_MS)),
        percent(over(JEV_CLIENT_LINE_MS)),
        whole(mean(tokens)),
        whole(mean(output)),
        `$${fixed((cost / calls.length) * 1000, 3)}`,
      ]);
    }
  }
  return table(
    [
      'use',
      'model',
      'calls',
      'failed',
      'wall ms p50 / p95',
      'API ms p50 / p95',
      'over 3 s',
      'over 10 s',
      'input tokens',
      'output tokens',
      'USD per 1,000 calls',
    ],
    body,
  );
}

export function failureTable(
  rows: readonly ResultRow[],
  all: readonly Reading[],
  variants: readonly string[],
): string {
  const body = variants.map((variant) => {
    const calls = rows.filter((row) => row.variant === variant);
    const reads = all.filter((row) => row.variant === variant);
    const reasons = new Map<string, number>();
    for (const row of calls.filter((entry) => !entry.ok)) {
      const reason = row.failure ?? 'unknown';
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    const offMass = reads.filter(
      (row) => row.read && row.type !== 'noul' && Math.abs(row.read.mass - 1) > MASS_SLACK,
    );
    return [
      variant,
      String(calls.length),
      String(calls.filter((row) => !row.ok).length),
      [...reasons].map(([reason, count]) => `${reason} ×${count}`).join(', ') || '—',
      String(reads.filter((row) => row.read === null).length),
      `${offMass.length} of ${reads.filter((row) => row.type !== 'noul').length}`,
    ];
  });
  return table(
    [
      'model',
      'calls',
      'failed calls',
      'reasons',
      'unreadable answers',
      'probabilities off 1 by over 0.05',
    ],
    body,
  );
}

function ordered(probabilities: Record<string, number>, scanOrder: readonly string[]): string[] {
  const position = new Map(scanOrder.map((path, index) => [path, index]));
  return [...scanOrder].sort(
    (a, b) =>
      (probabilities[b] ?? 0) - (probabilities[a] ?? 0) ||
      (position.get(a) ?? 0) - (position.get(b) ?? 0),
  );
}

export function rankTable(all: readonly Reading[], variants: readonly string[]): string {
  const ranked = all.filter((row) => row.item.use === 'rank' && row.probabilities);
  const mean = (values: readonly (number | null)[]) => {
    const kept = values.filter((value): value is number => value !== null);
    return kept.length === 0 ? null : kept.reduce((sum, value) => sum + value, 0) / kept.length;
  };
  const scanOrder = (row: Reading) =>
    optionKeys((row.item.request.questions as Record<string, Question>)[row.key]!);
  const body = variants.flatMap((variant) => {
    const rows = ranked.filter((row) => row.variant === variant);
    if (rows.length === 0) return [];
    const recall = (k: number, order: (row: Reading) => string[]) =>
      mean(rows.map((row) => recallAt(order(row), row.item.relevant ?? [], k)));
    const byModel = (row: Reading) => ordered(row.probabilities!, scanOrder(row));
    return [
      [
        variant,
        String(rows.length),
        whole(mean(rows.map((row) => scanOrder(row).length))),
        percent(recall(5, scanOrder)),
        percent(recall(5, byModel)),
        percent(recall(12, scanOrder)),
        percent(recall(12, byModel)),
      ],
    ];
  });
  return table(
    [
      'model',
      'requests',
      'candidate files',
      'recall@5 scan order',
      'recall@5 model order',
      'recall@12 scan order',
      'recall@12 model order',
    ],
    body,
  );
}

export function datasetTable(items: readonly Item[]): string {
  const uses = [...new Set(items.map((item) => item.use))].sort();
  const body = uses.map((use) => {
    const ofUse = items.filter((item) => item.use === use);
    const questions = ofUse.reduce(
      (sum, item) => sum + Object.keys(item.request.questions).length,
      0,
    );
    const labelled = ofUse.reduce((sum, item) => sum + Object.keys(item.truth).length, 0);
    const ranked = ofUse.filter((item) => item.relevant).length;
    const sources = [
      ...new Set(ofUse.map((item) => item.source.replace(/ \(.*| [A-Z0-9]+-.*\.json$/, ''))),
    ];
    return [
      use,
      String(ofUse.length),
      String(questions),
      String(labelled + ranked),
      sources.slice(0, 3).join('; '),
    ];
  });
  return table(['use', 'requests', 'questions', 'with ground truth', 'from'], body);
}

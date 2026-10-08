import { NOT } from './versus-labelled.ts';
import { levelKey, optionKeys, type Question } from './versus-ask.ts';
import type { Item } from './versus-items.ts';
import { fixed, percent, table } from './versus-format.ts';
import type { ResultRow } from './versus-run.ts';
import {
  agreement,
  lineForPrecision,
  readChoice,
  readLevels,
  readNoul,
  readScore,
  reliability,
  summarise,
  type Judged,
  type Read,
} from './versus-score.ts';

export const JEV = 'jev';

const ACT_AT: Readonly<Record<string, number>> = {
  'intake.need': 0.8,
  'intake.intent': 0.5,
  'intake.tier': 0.9,
  'verify.verdict': 0.8,
  'verify.unmet': 0,
  'mid_build.mid_build': 0.8,
  'pr_triage.item': 0.6,
  'map_label.category': 0.8,
  'map_label.kind': 0.8,
  'map_label.name': 0.8,
  'map_link.route': 0.8,
  'route_shadow.route': 0.65,
  'builders.builders': 0.7,
  'policy.noul': 0.7,
};
const ACT_AT_BY_TYPE: Readonly<Record<Question['type'], number>> = {
  choice: 0.8,
  score: 0.5,
  noul: 0.6,
};

const PIECE_SIGNAL = /_(kind|reasoning|coding|context|reliability)$/;

export function family(key: string): string {
  const signal = PIECE_SIGNAL.exec(key);
  return signal ? `piece_${signal[1]}` : key.replace(/_\d+$/, '');
}

function actAt(use: string, key: string, type: Question['type']): number {
  const named =
    ACT_AT[`${use}.${family(key)}`] ?? (use === 'policy' ? ACT_AT['policy.noul'] : null);
  return named ?? ACT_AT_BY_TYPE[type];
}

interface JevAnswer {
  type: string;
  probabilities?: Record<string, number>;
  score?: number;
  confidence?: number;
  noul?: number;
}

function jevRead(answer: unknown, question: Question): Read | null {
  const given = answer as JevAnswer | undefined;
  if (!given || given.type !== question.type) return null;
  if (question.type === 'choice')
    return given.probabilities ? readChoice(given.probabilities) : null;
  if (question.type === 'noul') return given.noul === undefined ? null : readNoul(given.noul);
  if (given.score === undefined || given.confidence === undefined) return null;
  return readScore(given.score, given.confidence, optionKeys(question).length);
}

function numbers(value: unknown, keys: readonly string[]): Record<string, number> | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const entries = keys.map((key) => [key, record[key]] as const);
  if (entries.some(([, entry]) => typeof entry !== 'number')) return null;
  return Object.fromEntries(entries) as Record<string, number>;
}

function haikuRead(answer: unknown, question: Question): Read | null {
  if (question.type === 'noul') return typeof answer === 'number' ? readNoul(answer) : null;
  const keys = optionKeys(question);
  const given = numbers(answer, keys);
  if (!given) return null;
  if (question.type === 'choice') return readChoice(given);
  return readLevels(keys.map((_, index) => given[levelKey(index)]!));
}

export interface Reading {
  item: Item;
  key: string;
  kind: string;
  type: Question['type'];
  variant: string;
  read: Read | null;
  probabilities: Record<string, number> | null;
  truth: string | null;
}

function resolvedTruth(read: Read, truth: string): string {
  if (!truth.startsWith(NOT)) return truth;
  return read.pick === truth.slice(NOT.length) ? `${NOT}${read.pick}` : read.pick;
}

export function readings(items: readonly Item[], rows: readonly ResultRow[]): Reading[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const found: Reading[] = [];
  for (const row of rows) {
    const item = byId.get(row.item);
    if (!item || !row.ok || !row.answers) continue;
    const questions = item.request.questions as Record<string, Question>;
    const keys = row.key ? [row.key] : Object.keys(questions);
    for (const key of keys) {
      const question = questions[key];
      if (!question) continue;
      const answer = row.answers[key];
      const read = row.variant === JEV ? jevRead(answer, question) : haikuRead(answer, question);
      const rawTruth = item.truth[key] ?? null;
      const probabilities =
        question.type !== 'choice'
          ? null
          : row.variant === JEV
            ? ((answer as JevAnswer | undefined)?.probabilities ?? null)
            : numbers(answer, optionKeys(question));
      found.push({
        item,
        key,
        kind: `${item.use}.${family(key)}`,
        type: question.type,
        variant: row.variant,
        read,
        probabilities,
        truth: read && rawTruth ? resolvedTruth(read, rawTruth) : rawTruth,
      });
    }
  }
  return found;
}

function judged(rows: readonly Reading[]): Judged[] {
  return rows.flatMap((row) => (row.read ? [{ read: row.read, truth: row.truth }] : []));
}

function pairKey(row: Reading): string {
  return `${row.item.id}|${row.key}`;
}

function pairs(left: readonly Reading[], right: readonly Reading[]) {
  const other = new Map(right.flatMap((row) => (row.read ? [[pairKey(row), row.read]] : [])));
  return left.flatMap((row) => {
    const match = other.get(pairKey(row));
    return row.read && match ? [[row.read, match] as const] : [];
  });
}

function sameItems(rows: readonly Reading[], other: readonly Reading[]): Reading[] {
  const wanted = new Set(rows.map(pairKey));
  return other.filter((row) => wanted.has(pairKey(row)));
}

function qualityCells(rows: readonly Reading[], line: number | null): string[] {
  const summary = line === null ? summariseMixed(rows) : summarise(judged(rows), line);
  return [
    percent(summary.accuracy),
    fixed(summary.brier, 3),
    fixed(summary.ece, 3),
    percent(summary.actRate),
    `${percent(summary.actPrecision)} (${summary.actedLabelled})`,
  ];
}

export function qualityTable(all: readonly Reading[], variants: readonly string[]): string {
  const kinds = [...new Set(all.map((row) => row.kind))].sort();
  const body: string[][] = [];
  for (const kind of [...kinds, 'ALL']) {
    const ofKind = kind === 'ALL' ? all : all.filter((row) => row.kind === kind);
    const jev = ofKind.filter((row) => row.variant === JEV);
    for (const variant of variants.filter((name) => name !== JEV)) {
      const rows = ofKind.filter((row) => row.variant === variant);
      if (rows.length === 0) continue;
      const first = rows[0]!;
      const line = kind === 'ALL' ? null : actAt(first.item.use, first.key, first.type);
      const paired = sameItems(rows, jev);
      const agrees = agreement(pairs(rows, paired));
      body.push([
        kind,
        variant,
        String(rows.length),
        String(rows.filter((row) => row.truth !== null).length),
        line === null ? 'own' : fixed(line),
        ...qualityCells(paired, line),
        ...qualityCells(rows, line),
        percent(agrees.samePick),
        fixed(agrees.meanConfidenceGap),
      ]);
    }
  }
  const measures = ['accuracy', 'Brier', 'ECE', 'acts on', 'right when acting (n)'];
  return table(
    [
      'question',
      'Haiku run',
      'n',
      'labelled',
      'act line',
      ...measures.map((name) => `Jev ${name}`),
      ...measures.map((name) => `Haiku ${name}`),
      'same pick',
      'confidence gap',
    ],
    body,
  );
}

export function ratingTable(all: readonly Reading[], variants: readonly string[]): string {
  const scores = all.filter((row) => row.type === 'score' && row.read);
  const jev = new Map(
    scores
      .filter((row) => row.variant === JEV)
      .map((row) => [pairKey(row), Number(row.read!.pick)]),
  );
  const kinds = [...new Set(scores.map((row) => row.kind))].sort();
  const body = kinds.flatMap((kind) =>
    variants
      .filter((name) => name !== JEV)
      .flatMap((variant) => {
        const gaps = scores
          .filter((row) => row.kind === kind && row.variant === variant && jev.has(pairKey(row)))
          .map((row) => Number(row.read!.pick) - jev.get(pairKey(row))!);
        if (gaps.length === 0) return [];
        const share = (test: (gap: number) => boolean) => gaps.filter(test).length / gaps.length;
        return [
          [
            kind,
            variant,
            String(gaps.length),
            percent(share((gap) => gap === 0)),
            percent(share((gap) => Math.abs(gap) <= 1)),
            percent(share((gap) => gap > 0)),
            percent(share((gap) => gap < 0)),
          ],
        ];
      }),
  );
  return table(
    ['rating', 'Haiku run', 'n', 'same level', 'within one level', 'Haiku higher', 'Haiku lower'],
    body,
  );
}

function summariseMixed(rows: readonly Reading[]) {
  const acted = rows.filter(
    (row) => row.read && row.read.confidence >= actAt(row.item.use, row.key, row.type),
  );
  const base = summarise(judged(rows), 2);
  const actedJudged = judged(acted).filter((row) => row.truth !== null);
  return {
    ...base,
    acted: acted.length,
    actRate: rows.length === 0 ? null : acted.length / rows.length,
    actedLabelled: actedJudged.length,
    actPrecision:
      actedJudged.length === 0
        ? null
        : actedJudged.filter((row) => row.read.pick === row.truth).length / actedJudged.length,
  };
}

export function reliabilityTable(all: readonly Reading[], variants: readonly string[]): string {
  const body = variants.flatMap((variant) =>
    reliability(judged(all.filter((row) => row.variant === variant)))
      .filter((bin) => bin.n > 0)
      .map((bin) => [
        variant,
        `${fixed(bin.from, 1)}–${fixed(bin.to, 1)}`,
        String(bin.n),
        fixed(bin.meanTop),
        percent(bin.accuracy),
      ]),
  );
  return table(['model', 'stated probability', 'n', 'mean stated', 'right'], body);
}

export function rethresholdTable(all: readonly Reading[], variants: readonly string[]): string {
  const kinds = [...new Set(all.filter((row) => row.truth !== null).map((row) => row.kind))].sort();
  const body = kinds.flatMap((kind) => {
    const ofKind = all.filter((row) => row.kind === kind);
    const first = ofKind[0]!;
    const line = actAt(first.item.use, first.key, first.type);
    const jev = summarise(judged(ofKind.filter((row) => row.variant === JEV)), line);
    if (jev.actPrecision === null) return [];
    return variants
      .filter((variant) => variant !== JEV)
      .flatMap((variant) => {
        const rows = judged(ofKind.filter((row) => row.variant === variant));
        if (rows.length === 0) return [];
        const needed = lineForPrecision(rows, jev.actPrecision!);
        const there = needed === null ? null : summarise(rows, needed);
        return [
          [
            kind,
            variant,
            fixed(line),
            `${percent(jev.actPrecision)} on ${percent(jev.actRate)}`,
            fixed(needed),
            there ? `${percent(there.actPrecision)} on ${percent(there.actRate)}` : '—',
          ],
        ];
      });
  });
  return table(
    [
      'question',
      'model',
      "Spark's line",
      'Jev at that line',
      'line that matches Jev',
      'at that line',
    ],
    body,
  );
}

import { noulConfidence, optionConfidence } from '../../apps/server/src/advisor/gate.ts';

export interface Read {
  pick: string;
  top: number;
  confidence: number;
  mass: number;
}

export interface Judged {
  read: Read;
  truth: string | null;
}

export interface Summary {
  n: number;
  labelled: number;
  accuracy: number | null;
  brier: number | null;
  ece: number | null;
  acted: number;
  actRate: number | null;
  actedLabelled: number;
  actPrecision: number | null;
}

export interface ReliabilityBin {
  from: number;
  to: number;
  n: number;
  meanTop: number | null;
  accuracy: number | null;
}

const BIN_EDGES = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 1.000001];

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function readChoice(probabilities: Readonly<Record<string, number>>): Read | null {
  const entries = Object.entries(probabilities);
  if (entries.length === 0 || entries.some(([, value]) => !Number.isFinite(value) || value < 0)) {
    return null;
  }
  const mass = entries.reduce((sum, [, value]) => sum + value, 0);
  if (mass <= 0) return null;
  const [pick, raw] = entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  const top = raw / mass;
  return { pick, top, confidence: optionConfidence(top, entries.length), mass };
}

export function readLevels(levels: readonly number[]): Read | null {
  if (levels.length < 2 || levels.some((value) => !Number.isFinite(value) || value < 0))
    return null;
  const mass = levels.reduce((sum, value) => sum + value, 0);
  if (mass <= 0) return null;
  const expected = levels.reduce((sum, value, index) => sum + (index * value) / mass, 0);
  const top = Math.max(...levels) / mass;
  return {
    pick: String(Math.round(expected)),
    top,
    confidence: optionConfidence(top, levels.length),
    mass,
  };
}

export function readScore(score: number, confidence: number, levels: number): Read | null {
  if (!Number.isFinite(score) || !Number.isFinite(confidence) || levels < 2) return null;
  const bounded = clampUnit(confidence);
  return {
    pick: String(Math.round(score)),
    top: (bounded * (levels - 1) + 1) / levels,
    confidence: bounded,
    mass: 1,
  };
}

export function readNoul(noul: number): Read | null {
  if (!Number.isFinite(noul) || noul < 0 || noul > 1) return null;
  return {
    pick: noul >= 0.5 ? 'true' : 'false',
    top: Math.max(noul, 1 - noul),
    confidence: noulConfidence(noul),
    mass: 1,
  };
}

function correct(row: Judged): boolean {
  return row.read.pick === row.truth;
}

export function reliability(rows: readonly Judged[]): ReliabilityBin[] {
  const labelled = rows.filter((row) => row.truth !== null);
  return BIN_EDGES.slice(0, -1).map((from, index) => {
    const to = BIN_EDGES[index + 1]!;
    const inBin = labelled.filter((row) => row.read.top >= from && row.read.top < to);
    return {
      from,
      to: Math.min(1, to),
      n: inBin.length,
      meanTop: mean(inBin.map((row) => row.read.top)),
      accuracy: mean(inBin.map((row) => Number(correct(row)))),
    };
  });
}

export function expectedCalibrationError(rows: readonly Judged[]): number | null {
  const bins = reliability(rows).filter((bin) => bin.n > 0);
  const total = bins.reduce((sum, bin) => sum + bin.n, 0);
  if (total === 0) return null;
  return bins.reduce(
    (sum, bin) => sum + (bin.n / total) * Math.abs(bin.meanTop! - bin.accuracy!),
    0,
  );
}

export function summarise(rows: readonly Judged[], actAt: number): Summary {
  const labelled = rows.filter((row) => row.truth !== null);
  const acted = rows.filter((row) => row.read.confidence >= actAt);
  const actedLabelled = acted.filter((row) => row.truth !== null);
  return {
    n: rows.length,
    labelled: labelled.length,
    accuracy: mean(labelled.map((row) => Number(correct(row)))),
    brier: mean(labelled.map((row) => (row.read.top - Number(correct(row))) ** 2)),
    ece: expectedCalibrationError(rows),
    acted: acted.length,
    actRate: rows.length === 0 ? null : acted.length / rows.length,
    actedLabelled: actedLabelled.length,
    actPrecision: mean(actedLabelled.map((row) => Number(correct(row)))),
  };
}

export function lineForPrecision(
  rows: readonly Judged[],
  target: number,
  minimum = 5,
): number | null {
  const lines = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
  for (const line of lines) {
    const summary = summarise(rows, line);
    if (summary.actedLabelled >= minimum && (summary.actPrecision ?? 0) >= target) return line;
  }
  return null;
}

export interface Agreement {
  n: number;
  samePick: number | null;
  meanConfidenceGap: number | null;
}

export function agreement(pairs: readonly (readonly [Read, Read])[]): Agreement {
  return {
    n: pairs.length,
    samePick: mean(pairs.map(([left, right]) => Number(left.pick === right.pick))),
    meanConfidenceGap: mean(
      pairs.map(([left, right]) => Math.abs(left.confidence - right.confidence)),
    ),
  };
}

export function percentile(values: readonly number[], share: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return sorted[index]!;
}

export function recallAt(ranked: readonly string[], relevant: readonly string[], k: number) {
  if (relevant.length === 0) return null;
  const head = new Set(ranked.slice(0, k));
  return relevant.filter((path) => head.has(path)).length / relevant.length;
}

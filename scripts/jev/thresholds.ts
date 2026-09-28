export interface Sample {
  score: number;
  positive: boolean;
}

export interface ThresholdRow {
  threshold: number;
  flagged: number;
  truePositives: number;
  precision: number | null;
  recall: number | null;
}

const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95];

export function thresholdTable(samples: readonly Sample[]): ThresholdRow[] {
  const positives = samples.filter((sample) => sample.positive).length;
  return THRESHOLDS.map((threshold) => {
    const flagged = samples.filter((sample) => sample.score >= threshold);
    const truePositives = flagged.filter((sample) => sample.positive).length;
    return {
      threshold,
      flagged: flagged.length,
      truePositives,
      precision: flagged.length > 0 ? truePositives / flagged.length : null,
      recall: positives > 0 ? truePositives / positives : null,
    };
  });
}

const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

export function renderTable(name: string, samples: readonly Sample[]): string {
  const positives = samples.filter((sample) => sample.positive).length;
  const lines = [
    `${name}: ${samples.length} observations, ${positives} labelled bad`,
    'threshold  flagged  true  precision  recall',
    ...thresholdTable(samples).map(
      (row) =>
        `${row.threshold.toFixed(2).padEnd(10)} ${String(row.flagged).padEnd(8)} ${String(row.truePositives).padEnd(5)} ${percent(row.precision).padEnd(10)} ${percent(row.recall)}`,
    ),
  ];
  return lines.join('\n');
}

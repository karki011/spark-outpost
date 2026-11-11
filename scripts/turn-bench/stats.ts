export interface Summary {
  n: number;
  median: number;
  p90: number;
  min: number;
  max: number;
}

const round = (value: number) => Math.round(value * 10) / 10;

export function summarize(samples: readonly number[]): Summary {
  if (samples.length === 0) return { n: 0, median: 0, p90: 0, min: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const p90 = sorted[Math.ceil(sorted.length * 0.9) - 1]!;
  return {
    n: sorted.length,
    median: round(median),
    p90: round(p90),
    min: round(sorted[0]!),
    max: round(sorted[sorted.length - 1]!),
  };
}

export function formatTable(header: readonly string[], rows: readonly string[][]): string {
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]!.length)),
  );
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) =>
        column === 0 ? cell.padEnd(widths[0]!) : cell.padStart(widths[column]!),
      )
      .join('  ');
  return [
    line(header),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map(line),
  ].join('\n');
}

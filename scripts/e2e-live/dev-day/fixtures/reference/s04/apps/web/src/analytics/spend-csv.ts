import type { AnalyticsSpend } from '@spark-outpost/contracts';

const HEADER = [
  'project',
  'provider',
  'model',
  'runs',
  'cost_usd',
  'reported_usd',
  'estimated_usd',
];

function field(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function spendCsv(data: AnalyticsSpend): string {
  const rows = data.leaves.map((leaf) =>
    [
      field(leaf.project),
      field(leaf.provider),
      field(leaf.model),
      String(leaf.runs),
      leaf.costUsd.toFixed(4),
      leaf.reportedUsd.toFixed(4),
      leaf.estimatedUsd.toFixed(4),
    ].join(','),
  );
  return [HEADER.join(','), ...rows].map((line) => `${line}\n`).join('');
}

export function downloadSpendCsv(data: AnalyticsSpend): void {
  const blob = new Blob([spendCsv(data)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `spend-${data.window.from}-${data.window.to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

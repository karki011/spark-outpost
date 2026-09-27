import type { AnalyticsHarness, ObservationSummary } from '@spark-outpost/contracts';
import { plural, usd } from './analytics-model.ts';
import { ChartCard, EmptyChart } from './charts/ChartCard.tsx';

const WOULD: Record<string, string> = {
  allow: 'Would allow',
  review: 'Would ask you',
  block: 'Would block',
  pass: 'Would pass',
  flag: 'Would flag',
};

const ROUTING: Record<string, string> = {
  same: 'Jev picked the same model',
  differs: 'Jev would have picked another',
  no_jev: 'No Jev pick',
};

function ObservationTable({ label, summary }: { label: string; summary: ObservationSummary }) {
  if (summary.checks === 0) {
    return (
      <EmptyChart>
        No {label.toLowerCase()} checks yet
        {summary.skipped > 0 ? ` (${summary.skipped} skipped with diffs off)` : ''}.
      </EmptyChart>
    );
  }
  return (
    <div className="an-table-wrap">
      <table className="an-table">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Jev</th>
            <th scope="col">What happened</th>
            <th scope="col" className="num">
              Checks
            </th>
          </tr>
        </thead>
        <tbody>
          {summary.rows.map((row) => (
            <tr key={`${row.would}:${row.actual}`}>
              <td>{WOULD[row.would] ?? row.would}</td>
              <td>{row.actual}</td>
              <td className="num">{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function observationSummary(data: AnalyticsHarness): string {
  const { policy, verify } = data.observation;
  const wouldAsk = policy.rows
    .filter((row) => row.would !== 'allow')
    .reduce((sum, row) => sum + row.count, 0);
  return `Observation mode records what Jev would do and never acts. The edit gate checked ${plural(policy.checks, 'edit')} and would have asked or blocked on ${wouldAsk}; the verifier checked ${plural(verify.checks, 'change')}.`;
}

export function ObservationCard({ data }: { data: AnalyticsHarness }) {
  return (
    <ChartCard
      title="Observation mode: would have asked or blocked"
      className="an-wide"
      summary={observationSummary(data)}
      n={data.observation.policy.checks + data.observation.verify.checks}
      noun="checks"
      table={{
        caption: 'Cost per verified completion by routing agreement',
        columns: [
          { label: 'Routing', value: (row) => ROUTING[row.key] ?? row.key },
          { label: 'Turns', value: (row) => row.turns, numeric: true },
          { label: 'Verified', value: (row) => row.verified, numeric: true },
          { label: 'Cost', value: (row) => usd(row.costUsd), numeric: true },
          {
            label: 'Cost per verified',
            value: (row) => usd(row.costPerVerifiedUsd),
            numeric: true,
          },
        ],
        rows: data.routingCost,
      }}
    >
      <ObservationTable label="Edit gate" summary={data.observation.policy} />
      <ObservationTable label="Verifier" summary={data.observation.verify} />
      <p className="an-note">
        Thresholds are provisional until tuned on these records; run pnpm jev:thresholds for
        precision and recall per threshold.
      </p>
    </ChartCard>
  );
}

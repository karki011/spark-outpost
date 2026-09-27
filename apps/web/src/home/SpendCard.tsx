import '../tasks/cost-pane.css';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { advisorLabel, type ProviderTotals, type SpendRange } from '@spark-outpost/contracts';
import { providerName } from '../chat/provider-name.ts';
import { Segmented } from '../ui/Segmented.tsx';
import { CostText } from '../usage/CostText.tsx';
import { costNote, formatCost } from '../usage/format.ts';
import { homeApi, homeKeys } from './home-api.ts';
import { HomeSection } from './HomeCards.tsx';
import { activityLine, costSlices, savingsLine, savingsTip } from './spend-model.ts';

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
];

const sliceColor = (provider: string) => `var(--c-${provider}, var(--muted))`;
const sliceName = (provider: string) =>
  provider === 'jev' ? advisorLabel(provider) : providerName(provider);

function SliceCost({ row }: { row: ProviderTotals }) {
  const note = costNote(row.costSource);
  return (
    <>
      <b>{formatCost(row.costUsd ?? 0, row.costSource)}</b>
      {note && <span className="spend-est">{note}</span>}
    </>
  );
}

function SpendSplit({ rows, total }: { rows: readonly ProviderTotals[]; total: number }) {
  const label = rows
    .map((row) => `${sliceName(row.provider)} ${formatCost(row.costUsd ?? 0, row.costSource)}`)
    .join(', ');
  return (
    <>
      <div className="cost-bar" role="img" aria-label={`Cost by provider: ${label}`}>
        {rows.map((row) => (
          <i
            key={row.provider}
            style={{
              width: `max(3px, ${((row.costUsd ?? 0) / total) * 100}%)`,
              background: sliceColor(row.provider),
            }}
          />
        ))}
      </div>
      <ul className="cost-legend" aria-label="Cost by provider">
        {rows.map((row) => (
          <li key={row.provider}>
            <i style={{ background: sliceColor(row.provider) }} />
            <span>{sliceName(row.provider)}</span>
            <SliceCost row={row} />
          </li>
        ))}
      </ul>
    </>
  );
}

function emptyNote(runs: number, range: SpendRange): string {
  const period = range === 'today' ? 'today' : 'this week';
  return runs > 0 ? `No provider reported a cost ${period}.` : `No spend ${period} yet.`;
}

export function SpendCard({ refresh, onUsage }: { refresh: string; onUsage: () => void }) {
  const [range, setRange] = useState<SpendRange>('today');
  const spend = useQuery({
    queryKey: [...homeKeys.spend(range), refresh],
    queryFn: () => homeApi.spend(range),
    placeholderData: keepPreviousData,
  });
  const summary = spend.data;
  const slices = summary ? costSlices(summary) : [];
  const total = slices.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
  const saved = summary ? savingsLine(summary.savings) : null;

  return (
    <HomeSection
      id="home-spend"
      title="Spend"
      className="hspend"
      action={
        <Segmented
          ariaLabel="Spend period"
          options={RANGES}
          value={range}
          onChange={(id) => setRange(id as SpendRange)}
        />
      }
    >
      <div className="hpanel" aria-busy={spend.isPending}>
        {spend.isError && <p className="home-error">{spend.error.message}</p>}
        {summary && (
          <>
            <div className="cost-total">
              <b>
                <CostText
                  usd={summary.costUsd}
                  source={summary.costSource}
                  empty={summary.runs > 0 ? 'Not reported' : '$0.00'}
                />
              </b>
              <span>{activityLine(summary)}</span>
            </div>
            {total > 0 ? (
              <SpendSplit rows={slices} total={total} />
            ) : (
              <p className="hnote">{emptyNote(summary.runs, range)}</p>
            )}
            {saved && summary.savings && (
              <p className="spend-save">
                <b>{saved}</b>
                <small>{savingsTip(summary.savings)}</small>
              </p>
            )}
          </>
        )}
        <button type="button" className="hlink" onClick={onUsage}>
          Open usage and audit
        </button>
      </div>
    </HomeSection>
  );
}

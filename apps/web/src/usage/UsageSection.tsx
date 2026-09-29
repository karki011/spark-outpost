import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  advisorLabel,
  mergeCostSource,
  providerIdSchema,
  type AdvisorUsage,
  type CategoryTotals,
  type ProviderTotals,
} from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { categoryName } from '../categories/category-usage.ts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { providerName } from '../chat/provider-name.ts';
import { formatTokens } from '../chat/composer/model-options.ts';
import { Segmented } from '../ui/Segmented.tsx';
import { CostText } from './CostText.tsx';
import './usage.css';
import { EmptyScene } from '../brand/EmptyScene.tsx';

type Range = 'last30Days' | 'allTime';

const RANGES = [
  { id: 'last30Days', label: 'Last 30 days' },
  { id: 'allTime', label: 'All time' },
];

function sumTotals(rows: ProviderTotals[]): ProviderTotals {
  return rows.reduce<ProviderTotals>(
    (total, row) => ({
      provider: 'total',
      runs: total.runs + row.runs,
      costUsd: row.costUsd === null ? total.costUsd : (total.costUsd ?? 0) + row.costUsd,
      costSource: mergeCostSource(total.costSource ?? null, row.costSource ?? null),
      inputTokens: total.inputTokens + row.inputTokens,
      outputTokens: total.outputTokens + row.outputTokens,
      totalTokens: total.totalTokens + row.totalTokens,
    }),
    {
      provider: 'total',
      runs: 0,
      costUsd: null,
      costSource: null,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
  );
}

function ProviderMark({ provider }: { provider: string }) {
  const known = providerIdSchema.safeParse(provider);
  if (!known.success) return <span className="provider-dot" aria-hidden="true" />;
  return <ProviderBlob providerId={known.data} size={28} />;
}

function UsageRow({ row, label }: { row: ProviderTotals; label: string }) {
  const replies = `${row.runs} ${row.runs === 1 ? 'reply' : 'replies'}`;
  return (
    <li className={row.provider === 'total' ? 'usage-row total' : 'usage-row'} aria-label={label}>
      <ProviderMark provider={row.provider} />
      <b>{label}</b>
      <span className={row.costUsd === null ? 'usage-cost none' : 'usage-cost'}>
        <CostText usd={row.costUsd} source={row.costSource} empty="No cost reported" />
      </span>
      <small>
        {replies} · {formatTokens(row.totalTokens)} tokens ({formatTokens(row.inputTokens)} in,{' '}
        {formatTokens(row.outputTokens)} out)
      </small>
    </li>
  );
}

function AdvisorRow({ entry }: { entry: AdvisorUsage }) {
  const label = advisorLabel(entry.advisor);
  return (
    <li className="usage-row" aria-label={label}>
      <ProviderMark provider={entry.advisor} />
      <b>{label}</b>
      <span className="usage-cost">
        <CostText usd={entry.costUsd} source="estimated" />
      </span>
      <small>
        {entry.calls} routing {entry.calls === 1 ? 'call' : 'calls'} ·{' '}
        {formatTokens(entry.inputTokens)} tokens in
      </small>
    </li>
  );
}

function CategoryRow({ row }: { row: CategoryTotals }) {
  const label = categoryName(row.category);
  return (
    <li className="usage-row category" aria-label={label}>
      <b>{label}</b>
      <span className={row.costUsd === null ? 'usage-cost none' : 'usage-cost'}>
        <CostText usd={row.costUsd} source={row.costSource} empty="No cost reported" />
      </span>
      <small>
        {row.turns} {row.turns === 1 ? 'turn' : 'turns'} · {formatTokens(row.totalTokens)} tokens
      </small>
    </li>
  );
}

export function UsageSection() {
  const [range, setRange] = useState<Range>('last30Days');
  const summary = useQuery({ queryKey: queryKeys.usageSummary, queryFn: api.getUsageSummary });
  const rows = summary.data?.[range] ?? [];
  const advisors = summary.data?.advisors?.[range] ?? [];
  const categories = summary.data?.byCategory?.[range] ?? [];

  return (
    <>
      <p className="lede">
        Tokens and cost for every reply, by provider. Claude reports its cost. Codex reports tokens
        only, so its cost is estimated from OpenAI&apos;s list prices and marked with ~.
      </p>
      <div className="usage-range">
        <Segmented
          ariaLabel="Usage period"
          options={RANGES}
          value={range}
          onChange={(id) => setRange(id as Range)}
        />
      </div>
      {summary.isError && <p className="usage-empty">{summary.error.message}</p>}
      {summary.data && rows.length === 0 && <EmptyScene>No replies in this period yet.</EmptyScene>}
      {rows.length + advisors.length > 0 && (
        <ul className="usage-list" aria-label="Usage by provider">
          {rows.map((row) => (
            <UsageRow key={row.provider} row={row} label={providerName(row.provider)} />
          ))}
          {rows.length > 1 && <UsageRow row={sumTotals(rows)} label="All providers" />}
          {advisors.map((entry) => (
            <AdvisorRow key={entry.advisor} entry={entry} />
          ))}
        </ul>
      )}
      {categories.some((row) => row.category !== null) && (
        <>
          <h3 className="usage-sub">By category</h3>
          <ul className="usage-list" aria-label="Usage by category">
            {categories.map((row) => (
              <CategoryRow key={row.category ?? 'none'} row={row} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

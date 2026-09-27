import './analytics-charts.css';
import './analytics.css';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  analyticsApi,
  analyticsKeys,
  type AnalyticsTab,
  type RangeChoice,
} from './analytics-api.ts';
import { HarnessTab } from './HarnessTab.tsx';
import { OverviewTab } from './OverviewTab.tsx';
import { daysBefore, localToday, RangePicker } from './RangePicker.tsx';
import { SpendTab } from './SpendTab.tsx';

const TABS: { id: AnalyticsTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'spend', label: 'Spend' },
  { id: 'harness', label: 'Harness' },
];

function usable(choice: RangeChoice): boolean {
  return choice.range !== 'custom' || choice.from <= choice.to;
}

function Panel<T>({ query, render }: { query: UseQueryResult<T>; render: (data: T) => ReactNode }) {
  if (query.isError)
    return (
      <p className="an-error" role="alert">
        {query.error.message}
      </p>
    );
  if (!query.data) return <p className="an-loading">Loading…</p>;
  return render(query.data);
}

export function Analytics() {
  const [tab, setTab] = useState<AnalyticsTab>('overview');
  const [choice, setChoice] = useState<RangeChoice>(() => {
    const to = localToday();
    return { range: '30d', from: daysBefore(to, 13), to };
  });
  const enabled = (id: AnalyticsTab) => tab === id && usable(choice);
  const options = { placeholderData: keepPreviousData, staleTime: 30_000 } as const;
  const overview = useQuery({
    queryKey: analyticsKeys.tab('overview', choice),
    queryFn: () => analyticsApi.overview(choice),
    enabled: enabled('overview'),
    ...options,
  });
  const spend = useQuery({
    queryKey: analyticsKeys.tab('spend', choice),
    queryFn: () => analyticsApi.spend(choice),
    enabled: enabled('spend'),
    ...options,
  });
  const harness = useQuery({
    queryKey: analyticsKeys.tab('harness', choice),
    queryFn: () => analyticsApi.harness(choice),
    enabled: enabled('harness'),
    ...options,
  });

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex((entry) => entry.id === tab);
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % TABS.length,
      ArrowLeft: (index - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setTab(TABS[next]!.id);
    document.getElementById(`an-tab-${TABS[next]!.id}`)?.focus();
  };

  const busy = { overview, spend, harness }[tab].isFetching;

  return (
    <main className="page" aria-labelledby="an-title">
      <div className="an">
        <div className="an-wrap">
          <header className="an-head">
            <div>
              <h1 id="an-title">Analytics</h1>
              <p>Where time, money and quality go. Everything here is computed on this machine.</p>
            </div>
            <RangePicker value={choice} onChange={setChoice} />
          </header>
          <div className="an-tabs" role="tablist" aria-label="Analytics views">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                id={`an-tab-${entry.id}`}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                aria-controls="an-panel"
                tabIndex={tab === entry.id ? 0 : -1}
                onClick={() => setTab(entry.id)}
                onKeyDown={onTabKey}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div
            id="an-panel"
            key={tab}
            className="an-panel"
            role="tabpanel"
            aria-labelledby={`an-tab-${tab}`}
            aria-busy={busy}
          >
            {tab === 'overview' && (
              <Panel query={overview} render={(data) => <OverviewTab data={data} />} />
            )}
            {tab === 'spend' && <Panel query={spend} render={(data) => <SpendTab data={data} />} />}
            {tab === 'harness' && (
              <Panel query={harness} render={(data) => <HarnessTab data={data} />} />
            )}
          </div>
          <p className="an-next">Sessions, Insights and Ask about this view come next.</p>
        </div>
      </div>
    </main>
  );
}

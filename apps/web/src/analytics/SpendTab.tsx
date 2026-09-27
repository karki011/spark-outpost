import { useId } from 'react';
import type { AnalyticsSpend } from '@spark-outpost/contracts';
import { providerName } from '../chat/provider-name.ts';
import { formatTokens } from '../chat/composer/model-options.ts';
import { plural, shortDate, usd, verdictName } from './analytics-model.ts';
import { ChartCard, EmptyChart } from './charts/ChartCard.tsx';
import { DailyStack } from './charts/DailyStack.tsx';
import { HBars } from './charts/HBars.tsx';
import { DotPattern, HatchPattern } from './charts/Patterns.tsx';
import { SpendTreemap } from './charts/SpendTreemap.tsx';
import {
  savingsSummary,
  sourceSummary,
  taskCostSummary,
  treemapSummary,
} from './spend-summaries.ts';

const VERDICT_COLORS = {
  good: 'var(--success)',
  mixed: 'var(--warn)',
  unclear: 'var(--muted)',
  bad: 'var(--danger)',
};

function TaskCosts({ data }: { data: AnalyticsSpend }) {
  const base = useId();
  const fills = {
    good: VERDICT_COLORS.good,
    mixed: `url(#${base}m)`,
    unclear: 'var(--panel)',
    bad: `url(#${base}b)`,
  };
  const rows = data.perTask.filter((row) => row.tasks > 0);
  return (
    <HBars
      ariaLabel="Mean cost per finished turn by outcome"
      defs={
        <>
          <DotPattern id={`${base}m`} color={VERDICT_COLORS.mixed} />
          <HatchPattern id={`${base}b`} color={VERDICT_COLORS.bad} />
        </>
      }
      bars={rows.map((row) => ({
        key: row.verdict,
        label: `${verdictName(row.verdict)} (${row.tasks})`,
        value: row.meanUsd ?? 0,
        valueText: usd(row.meanUsd),
        marker: row.medianUsd,
        fill: fills[row.verdict],
        stroke: row.verdict === 'good' ? undefined : VERDICT_COLORS[row.verdict],
        tip: `${verdictName(row.verdict)}: ${plural(row.tasks, 'turn')}, mean ${usd(row.meanUsd)}, median ${usd(row.medianUsd)}, ${usd(row.costUsd)} in total`,
      }))}
    />
  );
}

function Savings({ data }: { data: AnalyticsSpend }) {
  const hatch = useId();
  const savings = data.savings;
  if (!savings)
    return (
      <EmptyChart>
        No turns were routed by Jev in this range, so there is nothing to compare.
      </EmptyChart>
    );
  return (
    <>
      <p className="an-kpi">
        <b>{usd(Math.abs(savings.netUsd))}</b> {savings.netUsd >= 0 ? 'saved' : 'lost'} after Jev’s
        own cost
      </p>
      <HBars
        ariaLabel="Routing savings against the top model"
        defs={<HatchPattern id={hatch} color="var(--c-jev)" />}
        bars={[
          {
            key: 'gross',
            label: 'Saved by routing',
            value: Math.max(0, savings.grossUsd),
            valueText: usd(savings.grossUsd),
            fill: 'var(--accent)',
            tip: `Routing ${plural(savings.runs, 'run')} to cheaper models saved ${usd(savings.grossUsd)} against always using each provider’s top model`,
          },
          {
            key: 'jev',
            label: 'Jev’s own cost',
            value: savings.jevCostUsd,
            valueText: usd(savings.jevCostUsd),
            fill: `url(#${hatch})`,
            stroke: 'var(--c-jev)',
            tip: `Jev’s advice cost ${usd(savings.jevCostUsd)} (estimated)`,
          },
        ]}
      />
    </>
  );
}

export function SpendTab({ data }: { data: AnalyticsSpend }) {
  const agentUsd = data.leaves.reduce((sum, leaf) => sum + leaf.costUsd, 0);
  return (
    <div className="an-grid">
      <ChartCard
        title="Where the money went"
        className="an-wide"
        summary={treemapSummary(data)}
        n={data.leaves.reduce((sum, leaf) => sum + leaf.runs, 0)}
        table={{
          caption: 'Spend by project, provider and model',
          columns: [
            { label: 'Project', value: (leaf) => leaf.project },
            { label: 'Provider', value: (leaf) => providerName(leaf.provider) },
            { label: 'Model', value: (leaf) => leaf.modelLabel },
            { label: 'Runs', value: (leaf) => leaf.runs, numeric: true },
            { label: 'Reported', value: (leaf) => usd(leaf.reportedUsd), numeric: true },
            { label: 'Estimated', value: (leaf) => usd(leaf.estimatedUsd), numeric: true },
            { label: 'Total', value: (leaf) => usd(leaf.costUsd), numeric: true },
          ],
          rows: data.leaves,
        }}
      >
        {data.leaves.length === 0 ? (
          <EmptyChart>No priced runs in this range.</EmptyChart>
        ) : (
          <SpendTreemap leaves={data.leaves} total={agentUsd} />
        )}
      </ChartCard>
      <ChartCard
        title="Cost per finished turn"
        summary={taskCostSummary(data)}
        n={data.finishedTasks}
        noun="turns"
        aside={
          data.costPerGoodUsd !== null ? (
            <span className="an-chip">{usd(data.costPerGoodUsd)} per good outcome</span>
          ) : null
        }
        table={{
          caption: 'Cost per finished turn by outcome',
          columns: [
            { label: 'Outcome', value: (row) => verdictName(row.verdict) },
            { label: 'Turns', value: (row) => row.tasks, numeric: true },
            { label: 'Mean', value: (row) => usd(row.meanUsd), numeric: true },
            { label: 'Median', value: (row) => usd(row.medianUsd), numeric: true },
            { label: 'Total', value: (row) => usd(row.costUsd), numeric: true },
          ],
          rows: data.perTask,
        }}
      >
        {data.finishedTasks === 0 ? (
          <EmptyChart>No finished turns with an outcome yet.</EmptyChart>
        ) : (
          <>
            <TaskCosts data={data} />
            <p className="an-note">Bars show the mean; the tick marks the median.</p>
          </>
        )}
      </ChartCard>
      <ChartCard
        title="Reported and estimated"
        summary={sourceSummary(data)}
        n={data.days.length}
        noun="days"
        table={{
          caption: 'Reported and estimated spend per day',
          columns: [
            { label: 'Date', value: (day) => shortDate(day.date) },
            { label: 'Reported', value: (day) => usd(day.reportedUsd), numeric: true },
            { label: 'Estimated', value: (day) => usd(day.estimatedUsd), numeric: true },
          ],
          rows: data.days,
        }}
      >
        {data.totalUsd === 0 ? (
          <EmptyChart>No spend recorded in this range.</EmptyChart>
        ) : (
          <DailyStack days={data.days} />
        )}
      </ChartCard>
      <ChartCard
        title="What routing and resuming saved"
        summary={savingsSummary(data)}
        n={data.savings?.runs ?? 0}
        table={{
          caption: 'Savings',
          columns: [
            { label: 'Measure', value: (row) => row[0] },
            { label: 'Value', value: (row) => row[1], numeric: true },
          ],
          rows: [
            ['Runs routed by Jev and priced', String(data.savings?.runs ?? 0)],
            ['Saved against the top model', usd(data.savings?.grossUsd ?? null)],
            ['Jev’s own cost', usd(data.savings?.jevCostUsd ?? data.jev.costUsd)],
            ['Net', usd(data.savings?.netUsd ?? null)],
            ['Resumed sessions', `${data.resume.resumedRuns} of ${data.resume.sessionRuns}`],
            ['Cached input on resumed turns', formatTokens(data.resume.cachedTokens)],
            ['Estimated saving from resuming', usd(data.resume.savedUsd)],
          ] as [string, string][],
        }}
      >
        <Savings data={data} />
        <dl className="an-stats">
          <div>
            <dt>Resumed sessions</dt>
            <dd>
              {data.resume.resumedRuns} <small>of {data.resume.sessionRuns}</small>
            </dd>
          </div>
          <div>
            <dt>Cached input reused</dt>
            <dd>{formatTokens(data.resume.cachedTokens)}</dd>
          </div>
          <div>
            <dt>Saved by resuming</dt>
            <dd>~{usd(data.resume.savedUsd)}</dd>
          </div>
        </dl>
      </ChartCard>
    </div>
  );
}

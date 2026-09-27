import type { AnalyticsOverview } from '@spark-outpost/contracts';
import { percent, plural, ratePercent, shortDate, signedScore, usd } from './analytics-model.ts';
import { ActivityHeatmap } from './charts/ActivityHeatmap.tsx';
import { ChartCard, EmptyChart } from './charts/ChartCard.tsx';
import { HealthGauge } from './charts/HealthGauge.tsx';
import { RateRing } from './charts/RateRing.tsx';
import { SpendTrend } from './charts/SpendTrend.tsx';
import { VerdictBar } from './charts/VerdictBar.tsx';
import { activitySummary, healthSummary, outcomeSummary, spendSummary } from './summaries.ts';

export function OverviewTab({ data }: { data: AnalyticsOverview }) {
  const { totals, days, health } = data;
  const rated = totals.good + totals.bad + totals.mixed + totals.unclear;
  return (
    <div className="an-grid">
      <ChartCard
        title="Harness health"
        className="an-wide"
        summary={healthSummary(health)}
        n={totals.turns}
        noun="turns"
      >
        <HealthGauge health={health} />
        <details className="an-how">
          <summary>How the score is computed</summary>
          <p>
            Each part is a 0–100 score from what the harness recorded in this range: the share of
            turns with a good outcome (mixed counts half), checks that passed on the first round,
            turns that were not reverted or corrected, crew turns without a retry or fix round, and
            how quickly approvals were answered (30 seconds or less scores 100, 10 minutes or more
            scores 0). The health score is their weighted average. A part with fewer than 5 turns is
            left out and the others are reweighted; without enough outcomes there is no score.
          </p>
        </details>
      </ChartCard>
      <ChartCard
        title="Activity"
        summary={activitySummary(days)}
        n={totals.turns}
        noun="turns"
        table={{
          caption: 'Turns and spend per day',
          columns: [
            { label: 'Date', value: (day) => shortDate(day.date) },
            { label: 'Turns', value: (day) => day.turns, numeric: true },
            { label: 'Good', value: (day) => day.good, numeric: true },
            { label: 'Bad', value: (day) => day.bad, numeric: true },
            { label: 'Spend', value: (day) => usd(day.costUsd), numeric: true },
          ],
          rows: days.filter((day) => day.turns > 0 || day.costUsd > 0),
        }}
      >
        {totals.turns === 0 ? (
          <EmptyChart>No turns in this range yet.</EmptyChart>
        ) : (
          <ActivityHeatmap days={days} />
        )}
      </ChartCard>
      <ChartCard
        title="Spend trend"
        summary={spendSummary(days, totals.costUsd)}
        n={totals.runs}
        table={{
          caption: 'Spend per day',
          columns: [
            { label: 'Date', value: (day) => shortDate(day.date) },
            { label: 'Runs', value: (day) => day.runs, numeric: true },
            { label: 'Spend', value: (day) => usd(day.costUsd), numeric: true },
          ],
          rows: days,
        }}
      >
        {totals.costUsd === 0 ? (
          <EmptyChart>No spend recorded in this range.</EmptyChart>
        ) : (
          <SpendTrend points={days.map((day) => ({ date: day.date, value: day.costUsd }))} />
        )}
      </ChartCard>
      <ChartCard
        title="Keep and pass rates"
        className="an-wide"
        summary={outcomeSummary(totals)}
        n={rated}
        noun="turns"
        table={{
          caption: 'Outcome counts',
          columns: [
            { label: 'Measure', value: (row) => row[0] },
            { label: 'Value', value: (row) => row[1], numeric: true },
          ],
          rows: [
            ['Good', String(totals.good)],
            ['Mixed', String(totals.mixed)],
            ['Unclear', String(totals.unclear)],
            ['Bad', String(totals.bad)],
            ['Mean score', signedScore(totals.meanScore)],
            ['Kept', `${totals.kept} (${ratePercent(totals.keepRate)} of keep or revert)`],
            [
              'Checks passed first time',
              `${totals.checksPassedFirst} (${ratePercent(totals.checkPassRate)})`,
            ],
          ] as [string, string][],
        }}
      >
        {rated === 0 ? (
          <EmptyChart>No finished turns with an outcome yet.</EmptyChart>
        ) : (
          <div className="an-rates">
            <div className="an-rings">
              <RateRing
                label="Kept"
                rate={totals.keepRate}
                detail={`${totals.kept} kept, ${totals.reverted} reverted`}
              />
              <RateRing
                label="Checks pass first time"
                rate={totals.checkPassRate}
                detail={
                  totals.checkPassRate === null
                    ? 'No checks ran'
                    : `${totals.checksPassedFirst} of ${plural(totals.checkTurns, 'turn')}`
                }
              />
            </div>
            <div className="an-verdicts">
              <p className="an-kpi">
                <b>{percent(totals.good, rated)}</b> good outcomes · mean score{' '}
                {signedScore(totals.meanScore)}
              </p>
              <VerdictBar counts={totals} />
            </div>
          </div>
        )}
      </ChartCard>
    </div>
  );
}

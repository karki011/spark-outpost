import type { AnalyticsHarness, DisagreementRow } from '@spark-outpost/contracts';
import {
  categoryName,
  depthName,
  duration,
  fieldName,
  percent,
  pickName,
  plural,
  signedScore,
  usd,
  verdictName,
  winnerName,
} from './analytics-model.ts';
import { ChartCard, EmptyChart } from './charts/ChartCard.tsx';
import { ConfidenceChart } from './charts/ConfidenceChart.tsx';
import { HBars } from './charts/HBars.tsx';
import { RoutingFlow } from './charts/RoutingFlow.tsx';
import { ScoreBars } from './charts/ScoreBars.tsx';
import {
  confidenceSummary,
  disagreementSummary,
  flowSummary,
  frictionSummary,
  leanSummary,
  tallyTip,
} from './harness-summaries.ts';

const AGREEMENT_LABELS = { same: 'Same pick', differs: 'Different pick', no_jev: 'No Jev answer' };
const STYLE_LABELS = { off: 'Lean off', lite: 'Lite', lean: 'Lean' };

function WinnerChip({ row }: { row: DisagreementRow }) {
  const side = row.winner === 'jev' || row.winner === 'rules';
  const n = Math.min(row.jevRan.turns, row.rulesRan.turns);
  return (
    <span className={side ? 'an-win decided' : 'an-win'}>
      {side ? (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M3.5 8.5 6.5 11.5 12.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M4 8h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
      {winnerName(row.winner)}
      {row.winner === 'not_enough' && ` (n=${n})`}
    </span>
  );
}

function side(tally: DisagreementRow['jevRan']) {
  if (tally.turns === 0) return <span className="an-muted">did not run</span>;
  return (
    <>
      {tally.turns} · {percent(tally.good, tally.turns)} good ·{' '}
      <b>{signedScore(tally.meanScore)}</b>
    </>
  );
}

function DisagreementTable({ rows }: { rows: readonly DisagreementRow[] }) {
  return (
    <div className="an-table-wrap">
      <table className="an-table an-dis">
        <caption>Where the rules and Jev picked differently, and how each pick turned out</caption>
        <thead>
          <tr>
            <th scope="col">Choice</th>
            <th scope="col">Rule picked</th>
            <th scope="col">Jev picked</th>
            <th scope="col" className="num">
              Turns
            </th>
            <th scope="col">Jev’s pick ran</th>
            <th scope="col">Rule’s pick ran</th>
            <th scope="col">Better outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.field}-${row.rulePick}-${row.jevPick}`}>
              <th scope="row">{fieldName(row.field)}</th>
              <td>{pickName(row.field, row.rulePick)}</td>
              <td>{pickName(row.field, row.jevPick)}</td>
              <td className="num">
                {row.turns}
                {row.asked > 0 && <small> ({row.asked} asked)</small>}
              </td>
              <td>{side(row.jevRan)}</td>
              <td>{side(row.rulesRan)}</td>
              <td>
                <WinnerChip row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HarnessTab({ data }: { data: AnalyticsHarness }) {
  const buildingTurns = data.lean.reduce((sum, row) => sum + row.turns, 0);
  return (
    <div className="an-grid">
      <ChartCard
        title="Routing flow"
        className="an-wide"
        summary={flowSummary(data)}
        n={data.turns}
        noun="turns"
        table={{
          caption: 'Routing paths from request to outcome',
          columns: [
            { label: 'Request', value: (path) => categoryName(path.category) },
            { label: 'Depth', value: (path) => depthName(path.depth) },
            { label: 'Crew', value: (path) => path.crew },
            { label: 'Model', value: (path) => path.model },
            { label: 'Outcome', value: (path) => verdictName(path.outcome) },
            { label: 'Turns', value: (path) => path.turns, numeric: true },
          ],
          rows: data.flow,
        }}
      >
        {data.flow.length === 0 ? (
          <EmptyChart>No turns in this range yet.</EmptyChart>
        ) : (
          <>
            <RoutingFlow paths={data.flow} />
            <p className="an-note">
              Focus or hover a bar to trace its turns. Model bars use the provider colour.
            </p>
          </>
        )}
      </ChartCard>
      <ChartCard
        title="Jev confidence and outcome"
        className="an-wide"
        summary={confidenceSummary(data)}
        n={data.confidence.length}
        noun="turns"
        table={{
          caption: 'Jev confidence and outcome per turn',
          columns: [
            { label: 'Confidence', value: (point) => point.confidence.toFixed(2), numeric: true },
            { label: 'Gate', value: (point) => point.decision ?? '—' },
            { label: 'Line', value: (point) => point.actAt?.toFixed(2) ?? '—', numeric: true },
            { label: 'Outcome', value: (point) => verdictName(point.verdict) },
            { label: 'Score', value: (point) => signedScore(point.score), numeric: true },
          ],
          rows: data.confidence,
        }}
      >
        {data.confidence.length === 0 ? (
          <EmptyChart>Connect Jev to see how its confidence lines up with outcomes.</EmptyChart>
        ) : (
          <ConfidenceChart points={data.confidence} />
        )}
      </ChartCard>
      <ChartCard
        title="Rule vs Jev"
        className="an-wide"
        summary={disagreementSummary(data)}
        n={data.agreement.find((row) => row.key === 'differs')?.turns ?? 0}
        noun="turns"
        table={{
          caption: 'Outcomes by agreement',
          columns: [
            { label: 'Picks', value: (row) => AGREEMENT_LABELS[row.key] },
            { label: 'Turns', value: (row) => row.turns, numeric: true },
            { label: 'Good', value: (row) => row.good, numeric: true },
            { label: 'Bad', value: (row) => row.bad, numeric: true },
            { label: 'Mean score', value: (row) => signedScore(row.meanScore), numeric: true },
          ],
          rows: data.agreement,
        }}
      >
        <ScoreBars
          ariaLabel="Mean outcome score by agreement"
          rows={data.agreement.map((row) => ({
            key: row.key,
            label: AGREEMENT_LABELS[row.key],
            score: row.meanScore,
            note: plural(row.turns, 'turn'),
            tip: tallyTip(AGREEMENT_LABELS[row.key], row),
          }))}
        />
        {data.disagreements.length > 0 && <DisagreementTable rows={data.disagreements} />}
        <p className="an-note">
          “Better outcome” compares the mean score of the turns where each pick actually ran; it
          needs 3 or more turns on each side and a gap of at least 0.2.
        </p>
      </ChartCard>
      <ChartCard
        title="Lean and the Critic"
        summary={leanSummary(data)}
        n={buildingTurns}
        noun="turns"
        table={{
          caption: 'Outcomes by build style',
          columns: [
            { label: 'Style', value: (row) => STYLE_LABELS[row.style] },
            { label: 'Turns', value: (row) => row.turns, numeric: true },
            { label: 'Kept', value: (row) => row.kept, numeric: true },
            { label: 'Mean score', value: (row) => signedScore(row.meanScore), numeric: true },
            { label: 'Mean cost', value: (row) => usd(row.meanCostUsd), numeric: true },
            {
              label: 'Lines the Critic would cut',
              value: (row) => Math.abs(row.netLines),
              numeric: true,
            },
          ],
          rows: data.lean,
        }}
      >
        {buildingTurns === 0 ? (
          <EmptyChart>No building turns in this range.</EmptyChart>
        ) : (
          <>
            <ScoreBars
              ariaLabel="Mean outcome score by build style"
              rows={data.lean.map((row) => ({
                key: row.style,
                label: STYLE_LABELS[row.style],
                score: row.meanScore,
                note: `${row.turns} · ${usd(row.meanCostUsd)}`,
                tip: `${tallyTip(STYLE_LABELS[row.style], row)}, mean cost ${usd(row.meanCostUsd)}, ${row.kept} kept`,
              }))}
            />
            <ScoreBars
              ariaLabel="Mean outcome score with and without a Critic review"
              rows={[
                { key: 'reviewed', label: 'Reviewed', tally: data.critic.reviewed },
                { key: 'unreviewed', label: 'Not reviewed', tally: data.critic.unreviewed },
              ].map(({ key, label, tally }) => ({
                key,
                label,
                score: tally.meanScore,
                note: plural(tally.turns, 'turn'),
                tip: tallyTip(label, tally),
              }))}
            />
            <dl className="an-stats">
              <div>
                <dt>Reviews</dt>
                <dd>{data.critic.reviews}</dd>
              </div>
              <div>
                <dt>With concerns</dt>
                <dd>
                  {data.critic.concerns}{' '}
                  <small>{percent(data.critic.concerns, data.critic.reviews)}</small>
                </dd>
              </div>
              <div>
                <dt>Findings</dt>
                <dd>{data.critic.findings}</dd>
              </div>
            </dl>
          </>
        )}
      </ChartCard>
      <ChartCard
        title="Checks, loops and approvals"
        summary={frictionSummary(data)}
        n={data.loops.turns}
        noun="crew turns"
        table={{
          caption: 'Approval waits by kind',
          columns: [
            { label: 'Kind', value: (row) => row.kind },
            { label: 'Answered', value: (row) => row.count, numeric: true },
            { label: 'Median wait', value: (row) => duration(row.medianMs), numeric: true },
            { label: '90th percentile', value: (row) => duration(row.p90Ms), numeric: true },
          ],
          rows: data.approvals.byKind,
        }}
      >
        <dl className="an-stats">
          <div>
            <dt>First-time pass</dt>
            <dd>
              {percent(data.checks.firstPassed, data.checks.turns)}{' '}
              <small>of {data.checks.turns}</small>
            </dd>
          </div>
          <div>
            <dt>Fix rounds</dt>
            <dd>{data.checks.fixLoops}</dd>
          </div>
          <div>
            <dt>Retries</dt>
            <dd>{data.loops.retries}</dd>
          </div>
          <div>
            <dt>Median wait</dt>
            <dd>{duration(data.approvals.medianMs)}</dd>
          </div>
        </dl>
        {data.approvals.byKind.length > 0 && (
          <HBars
            ariaLabel="Median approval wait by kind"
            bars={data.approvals.byKind.map((row) => ({
              key: row.kind,
              label: `${row.kind.charAt(0).toUpperCase()}${row.kind.slice(1)} (${row.count})`,
              value: row.medianMs ?? 0,
              valueText: duration(row.medianMs),
              marker: row.p90Ms,
              fill: 'var(--accent)',
              tip: `${row.kind}: ${plural(row.count, 'approval')}, median wait ${duration(row.medianMs)}, 90th percentile ${duration(row.p90Ms)}`,
            }))}
          />
        )}
      </ChartCard>
    </div>
  );
}

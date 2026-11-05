import { memo, useEffect, useMemo, useState } from 'react';
import { providerLabel, type AuditRunSummary } from '@spark-outpost/contracts';
import { providerColor } from '../chat/provider-name.ts';
import {
  auditTurns,
  clockTime,
  formatDuration,
  isLive,
  runLabel,
  tickLabel,
  waterfall,
  type AuditTurn,
} from './audit-model.ts';
import { ProviderDot } from './AuditTable.tsx';
import { EmptyScene } from '../brand/EmptyScene.tsx';

function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return now;
}

const FROZEN_NOW = 0;

function turnTicks(turn: AuditTurn): boolean {
  return turn.runs.some((run) => isLive(run) || run.approvalWaits.some((wait) => !wait.end));
}

const TurnWaterfall = memo(function TurnWaterfall({
  turn,
  index,
  now,
}: {
  turn: AuditTurn;
  index: number;
  now: number;
}) {
  const chart = waterfall(turn, now);
  const active = Math.max(0, chart.wallMs - chart.waitMs);
  const pct = (value: number) => `${value}%`;
  return (
    <figure className="wf" aria-label={`Turn ${index + 1}`}>
      <figcaption className="wf-h">
        <b>
          Turn {index + 1} · {clockTime(new Date(chart.startedAt).toISOString()).slice(0, 8)}
        </b>
        <span>
          {formatDuration(chart.wallMs)} wall · {formatDuration(active)} active
          {chart.waitMs > 0 && ` · ${formatDuration(chart.waitMs)} waiting for you`}
        </span>
      </figcaption>
      <div className="wf-grid">
        {chart.bars.map((bar) => (
          <div className="wf-row" key={bar.run.runId}>
            <div className="wf-lab">
              <ProviderDot provider={bar.run.provider} />
              <span>{runLabel(bar.run)}</span>
              {bar.run.unreviewedCount ? (
                <span className="unrev">{bar.run.unreviewedCount} ran without review</span>
              ) : null}
            </div>
            <div className="wf-track">
              <div
                className={bar.live ? 'wf-bar live' : 'wf-bar'}
                style={{
                  left: pct(bar.left),
                  width: pct(bar.width),
                  ['--bc' as string]: providerColor(bar.run.provider),
                }}
                title={`${bar.run.model ?? providerLabel(bar.run.provider)} · ${bar.seconds.toFixed(1)}s`}
              >
                <span>{bar.run.model ?? bar.run.status}</span>
              </div>
            </div>
          </div>
        ))}
        {chart.waits.length > 0 && (
          <div className="wf-ov" aria-hidden="true">
            {chart.waits.map((wait, waitIndex) => (
              <div
                className="wf-gap"
                key={waitIndex}
                style={{ left: pct(wait.left), width: pct(wait.width) }}
              >
                <span>{wait.auto ? 'Continued automatically' : 'Waiting for you'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="wf-axis" aria-hidden="true">
        <span />
        <div>
          {chart.ticks.map((tick) => (
            <i key={tick} style={{ left: pct((tick / chart.scaleSeconds) * 100) }}>
              {tickLabel(tick)}
            </i>
          ))}
        </div>
      </div>
    </figure>
  );
});

export function AuditTimeline({ runs }: { runs: readonly AuditRunSummary[] }) {
  const now = useNow(runs.some(isLive));
  const turns = useMemo(() => auditTurns(runs), [runs]);
  const providers = [...new Set(runs.map((run) => run.provider))];
  const waited = runs.some((run) => run.approvalWaits.length > 0);
  if (turns.length === 0) return <EmptyScene>No runs in this chat yet.</EmptyScene>;
  return (
    <>
      <p className="lede">
        Who worked when, per turn. Shaded stretches are time a run waited for your approval.
      </p>
      {turns.map((turn, index) => (
        <TurnWaterfall
          key={turn.key}
          turn={turn}
          index={index}
          now={turnTicks(turn) ? now : FROZEN_NOW}
        />
      ))}
      <div className="wf-legend">
        {providers.map((provider) => (
          <span key={provider}>
            <i className="sw" style={{ background: providerColor(provider) }} aria-hidden="true" />
            {providerLabel(provider)}
          </span>
        ))}
        {waited && (
          <span>
            <i className="sw wait" aria-hidden="true" />
            Waiting for you
          </span>
        )}
      </div>
    </>
  );
}

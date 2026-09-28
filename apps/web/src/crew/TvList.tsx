import './tv-list.css';
import { useId, useRef, useState } from 'react';
import type { ConnectableId } from '@spark-outpost/contracts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { formatDuration } from '../audit/audit-model.ts';
import { ChevronIcon, TrashIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { CrewBlob } from './CrewBlob.tsx';
import { crewExpression } from './crew-model.ts';
import { StopIcon } from './tv-icons.tsx';
import { TvElapsed } from './TvElapsed.tsx';
import {
  activityText,
  needsYou,
  outcomeOf,
  outcomeWord,
  rowIsLive,
  rowUsage,
  type TvRow,
  type TvRows,
} from './tv-list.ts';

const PROVIDERS: ReadonlySet<string> = new Set(['claude', 'codex', 'zai', 'jev']);

interface TvListProps {
  rows: TvRows;
  cleared: ReadonlySet<string>;
  stopping: string | null;
  onPick(agentId: string): void;
  onAsk(approvalId: string): void;
  onStop(runId: string): void;
  onClear(keys: readonly string[]): void;
}

function RowBlob({ item }: { item: TvRow }) {
  if (PROVIDERS.has(item.provider)) {
    return (
      <ProviderBlob
        providerId={item.provider as ConnectableId}
        size={28}
        expression={crewExpression(item.state)}
      />
    );
  }
  return <CrewBlob name={item.name} provider={item.provider} state={item.state} size={28} />;
}

function StopButton({
  item,
  stopping,
  onStop,
}: {
  item: TvRow;
  stopping: boolean;
  onStop(runId: string): void;
}) {
  const label = item.dispatcher ? 'Stop the whole turn' : `Stop ${item.name}`;
  const tip = useTooltip(label);
  return (
    <>
      <button
        type="button"
        className="icon-btn tvl-stop"
        aria-label={label}
        disabled={stopping}
        aria-busy={stopping || undefined}
        {...tip.triggerProps}
        onClick={() => onStop(item.runId)}
      >
        <StopIcon />
      </button>
      {tip.tooltip}
    </>
  );
}

function Row({
  item,
  finished,
  stopping,
  onPick,
  onAsk,
  onStop,
}: {
  item: TvRow;
  finished: boolean;
  stopping: boolean;
  onPick(agentId: string): void;
  onAsk(approvalId: string): void;
  onStop(runId: string): void;
}) {
  const asking = !finished && needsYou(item);
  const outcome = outcomeOf(item.state);
  const live = !finished && rowIsLive(item);
  const classes = [
    'tvl-row',
    asking && 'tvl-needs',
    live && 'tvl-live',
    finished && `out-${outcome}`,
  ];
  const title = item.role ? `${item.name} · ${item.role}` : item.name;
  return (
    <li
      className={classes.filter(Boolean).join(' ')}
      data-run={item.runId}
      data-state={item.state}
      aria-label={title}
    >
      <span className="tvl-blob">
        <RowBlob item={item} />
        {live && <i className="tvl-pulse" aria-hidden="true" />}
      </span>
      <div className="tvl-main">
        <div className="tvl-title">
          <b>{item.name}</b>
          {item.role && <span className="tvl-role">· {item.role}</span>}
          {asking &&
            (item.ask ? (
              <button
                type="button"
                className="tvl-ask"
                title={item.ask.text}
                onClick={() => onAsk(item.ask!.approvalId)}
              >
                Needs you
              </button>
            ) : (
              <span className="tvl-ask">Needs you</span>
            ))}
          {finished && <span className={`tvl-out ${outcome}`}>{outcomeWord(outcome)}</span>}
        </div>
        <div className="tvl-meta">
          <span>{item.dispatcher ? 'Dispatcher' : 'Agent'}</span>
          {finished ? (
            item.durationMs !== null && <span>{formatDuration(item.durationMs)}</span>
          ) : item.startedAt !== null ? (
            <span>
              <TvElapsed since={item.startedAt} />
            </span>
          ) : null}
          <span>{item.model}</span>
          {rowUsage(item).map((part) => (
            <span key={part}>{part}</span>
          ))}
        </div>
        <div className="tvl-act">
          <span className="tvl-line">{activityText(item)}</span>
          <button
            type="button"
            className="tvl-open"
            aria-label={`Open ${item.name} in the chat`}
            onClick={() => onPick(item.agentId)}
          >
            Open
          </button>
        </div>
      </div>
      {!finished && <StopButton item={item} stopping={stopping} onStop={onStop} />}
    </li>
  );
}

export function TvList({ rows, cleared, stopping, onPick, onAsk, onStop, onClear }: TvListProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const runningId = useId();
  const finishedId = useId();
  const clearTip = useTooltip('Clear finished');
  const finished = rows.finished.filter((item) => !cleared.has(item.key));
  const common = { onPick, onAsk, onStop };

  const clear = () => {
    onClear(finished.map((item) => item.key));
    root.current?.focus({ preventScroll: true });
  };

  return (
    <div ref={root} className="tvl" tabIndex={-1}>
      <section aria-labelledby={runningId}>
        <h3 className="tvl-h" id={runningId}>
          Running <span className="tvl-n">{rows.running.length}</span>
        </h3>
        {rows.running.length > 0 ? (
          <ul className="tvl-rows" aria-label="Running">
            {rows.running.map((item) => (
              <Row
                key={item.key}
                item={item}
                finished={false}
                stopping={stopping === item.runId}
                {...common}
              />
            ))}
          </ul>
        ) : (
          <p className="tvl-empty">Nothing running right now.</p>
        )}
      </section>
      {finished.length > 0 && (
        <section className="tvl-fin">
          <div className="tvl-fh">
            <button
              type="button"
              className="tvl-toggle"
              aria-expanded={open}
              aria-controls={open ? finishedId : undefined}
              onClick={() => setOpen(!open)}
            >
              Finished <span className="tvl-n">{finished.length}</span>
              <ChevronIcon />
            </button>
            <button
              type="button"
              className="icon-btn tvl-clear"
              aria-label="Clear finished"
              {...clearTip.triggerProps}
              onClick={clear}
            >
              <TrashIcon />
            </button>
            {clearTip.tooltip}
          </div>
          {open && (
            <ul className="tvl-rows" id={finishedId} aria-label="Finished">
              {finished.map((item) => (
                <Row key={item.key} item={item} finished stopping={false} {...common} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

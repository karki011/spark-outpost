import './composer-status.css';
import { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Run } from '@spark-outpost/contracts';
import { AgentBlob } from '../../brand/AgentBlob.tsx';
import type { BlobExpression } from '../../brand/blob-expression.ts';
import { ArrowUpIcon, ChevronIcon } from '../../ui/icons.tsx';
import { WAITING_KEYS } from '../../ui/Keys.tsx';
import { hasModifier } from '../../ui/shortcuts.ts';
import { useTooltip } from '../../ui/Tooltip.tsx';
import { useExpandReveal } from '../../ui/transitions.tsx';
import { focusPending, useFocusHandoff } from './focus-pending.ts';
import { summaryText } from './pending-summary.ts';
import type { StepActivity } from './step-activity.ts';
import { SummaryText } from './SummaryText.tsx';
import { clockText } from './status-text.ts';
import type { PendingEntry, StatusStore } from './status-store.ts';
import {
  SLOW_STEP_MS,
  useNow,
  useStatusLine,
  useThrottled,
  type StatusLine,
} from './use-status-line.ts';

const ANNOUNCE_GAP_MS = 4_000;
const NO_ENTRIES: readonly PendingEntry[] = [];

function announcement(line: StatusLine | null): string {
  if (!line) return '';
  if (line.kind === 'waiting') {
    const first = summaryText(line.entries[0]!.summary);
    if (line.entries.length === 1) return `Waiting for you: ${first}`;
    return `${line.entries.length} things are waiting for you. First: ${first}`;
  }
  if (line.kind === 'running') {
    const activity = line.activity;
    if (!activity) return 'Thinking';
    return activity.target ? `${activity.verb} ${activity.target}` : activity.verb;
  }
  return line.elapsed === null ? line.word : `${line.word} after ${clockText(line.elapsed)}`;
}

function useWaitingShortcut(entries: readonly PendingEntry[]) {
  useEffect(() => {
    const first = entries[0];
    if (!first) return;
    const onKey = (event: KeyboardEvent) => {
      if (!hasModifier(event) || !event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== 'y') return;
      event.preventDefault();
      focusPending(first.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entries]);
}

function Dot() {
  return (
    <>
      {' '}
      <span className="cs-dot" aria-hidden="true">
        ·
      </span>{' '}
    </>
  );
}

function Indicator({
  provider,
  expression,
  still = false,
}: {
  provider: string;
  expression: BlobExpression;
  still?: boolean;
}) {
  return (
    <span className="cs-blob" aria-hidden="true">
      <AgentBlob
        provider={provider}
        size={18}
        expression={expression}
        animate={still ? 'hover' : 'always'}
      />
    </span>
  );
}

function WaitingLine({
  entries,
  provider,
}: {
  entries: readonly PendingEntry[];
  provider: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const first = entries[0]!;
  const single = entries.length === 1;
  const tip = useTooltip(
    single ? first.summary.full : `${entries.length} things are waiting for you`,
    { side: 'top', keys: WAITING_KEYS },
  );
  const jump = (id: string) => {
    setOpen(false);
    focusPending(id);
  };
  return (
    <>
      <div className="cs-line wait">
        <Indicator provider={provider} expression="unsure" />
        {single ? (
          <button
            type="button"
            className="cs-main"
            onClick={() => jump(first.id)}
            {...tip.triggerProps}
          >
            <span className="cs-word">Waiting for you</span>
            <Dot />
            <span className="cs-what">
              <SummaryText summary={first.summary} />
            </span>{' '}
            <span className="cs-go">
              Review
              <ArrowUpIcon />
            </span>
          </button>
        ) : (
          <button
            type="button"
            className={open ? 'cs-main open' : 'cs-main'}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen(!open)}
            {...tip.triggerProps}
          >
            <span className="cs-word">Waiting for you</span>
            <Dot />
            <span className="cs-what">{entries.length} things</span>{' '}
            <span className="cs-go">
              {open ? 'Hide' : 'Show'}
              <ChevronIcon />
            </span>
          </button>
        )}
        {tip.tooltip}
      </div>
      {!single && open && (
        <ul className="cs-list" id={listId} aria-label="Waiting for you">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button type="button" title={entry.summary.full} onClick={() => jump(entry.id)}>
                <SummaryText summary={entry.summary} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RunningLine({
  provider,
  activity,
  since,
}: {
  provider: string;
  activity: StepActivity | null;
  since: number | null;
}) {
  const now = useNow(since !== null);
  const elapsed = since === null ? 0 : now - since;
  const tip = useTooltip(activity?.full ?? 'Thinking', { side: 'top' });
  return (
    <p className="cs-line run">
      <Indicator provider={provider} expression="thinking" />
      <span className="cs-word">{activity?.verb ?? 'Thinking…'}</span>
      {activity?.target && (
        <>
          <Dot />
          <span className="cs-what" {...tip.triggerProps}>
            {activity.code ? <code>{activity.target}</code> : activity.target}
          </span>
        </>
      )}
      {elapsed >= SLOW_STEP_MS && (
        <>
          <Dot />
          <span className="cs-time">{clockText(elapsed)}</span>
        </>
      )}
      {tip.tooltip}
    </p>
  );
}

function EndedLine({
  provider,
  word,
  elapsed,
}: {
  provider: string;
  word: string;
  elapsed: number | null;
}) {
  return (
    <p className="cs-line end">
      <Indicator provider={provider} expression={word === 'Done' ? 'happy' : 'sleepy'} still />
      <span className="cs-word">{word}</span>
      {elapsed !== null && (
        <>
          <Dot />
          <span className="cs-time">{clockText(elapsed)}</span>
        </>
      )}
    </p>
  );
}

function LineBody({ line, provider }: { line: StatusLine; provider: string }) {
  if (line.kind === 'waiting') return <WaitingLine entries={line.entries} provider={provider} />;
  if (line.kind === 'running') {
    return <RunningLine provider={line.provider} activity={line.activity} since={line.since} />;
  }
  return <EndedLine provider={provider} word={line.word} elapsed={line.elapsed} />;
}

interface ComposerStatusProps {
  store: StatusStore;
  runs: readonly Run[];
  activeRunId: string | null;
  provider: string;
}

export function ComposerStatus({ store, runs, activeRunId, provider }: ComposerStatusProps) {
  const line = useStatusLine({ store, runs, activeRunId, provider });
  const pending = line?.kind === 'waiting' ? line.entries : NO_ENTRIES;
  useFocusHandoff(pending);
  useWaitingShortcut(pending);
  const said = useThrottled(announcement(line), ANNOUNCE_GAP_MS);
  const expand = useExpandReveal();
  return (
    <div className="cstatus" data-state={line?.kind ?? 'idle'}>
      <p className="sr-only" role="status">
        {said}
      </p>
      <AnimatePresence initial={false}>
        {line && (
          <motion.div key="line" className="cs-wrap" {...expand}>
            <LineBody line={line} provider={provider} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

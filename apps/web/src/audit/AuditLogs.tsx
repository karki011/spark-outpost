import { useId, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type {
  AuditRunSummary,
  ProtocolDirection,
  ProtocolLogEntry,
} from '@spark-outpost/contracts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { ChevronIcon } from '../ui/icons.tsx';
import { useDebouncedValue } from '../ui/use-debounced-value.ts';
import { auditApi, auditKeys, type LogFilters } from './audit-api.ts';
import { clockTime, entrySummary, jsonTokens } from './audit-model.ts';
import { BadgeView, runBadge, type ChainChecks } from './ChainBadge.tsx';
import { EmptyScene } from '../brand/EmptyScene.tsx';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';

const DIRECTIONS: { id: ProtocolDirection | 'all'; label: string }[] = [
  { id: 'all', label: 'All entries' },
  { id: 'to_agent', label: 'To agent' },
  { id: 'from_agent', label: 'From agent' },
  { id: 'harness', label: 'Spark' },
];

function Json({ value }: { value: unknown }) {
  return (
    <pre>
      {jsonTokens(value).map((token, index) =>
        token.kind === 'plain' ? (
          token.text
        ) : (
          <span key={index} className={`j-${token.kind}`}>
            {token.text}
          </span>
        ),
      )}
    </pre>
  );
}

const DIRECTION_ARROWS: Record<ProtocolLogEntry['direction'], string> = {
  to_agent: '→',
  from_agent: '←',
  harness: '•',
};

const DIRECTION_TITLES: Record<ProtocolLogEntry['direction'], string> = {
  to_agent: 'To agent',
  from_agent: 'From agent',
  harness: 'Spark',
};

function LogRow({ entry, broken }: { entry: ProtocolLogEntry; broken: boolean }) {
  const [open, setOpen] = useState(false);
  const rawId = useId();
  const arrow = DIRECTION_ARROWS[entry.direction];
  return (
    <li className={open ? 'lrow open' : 'lrow'}>
      <button
        type="button"
        className="lrow-h"
        aria-expanded={open}
        aria-controls={rawId}
        onClick={() => setOpen(!open)}
      >
        <span className="lt">{clockTime(entry.at)}</span>
        <span className={`ldir ${entry.direction}`} title={DIRECTION_TITLES[entry.direction]}>
          {arrow}
        </span>
        <span className="ls">
          <span className={`ltype ${entry.kind}`}>{entry.kind}</span>
          {entrySummary(entry)}
        </span>
        <ChevronIcon />
      </button>
      {open && (
        <div className="lraw" id={rawId}>
          <Json value={entry.payload} />
          <div className="lhash">
            <span>seq {entry.seq}</span>
            <span>{entry.at}</span>
            {entry.rpcId && <span>id {entry.rpcId}</span>}
            <span>{entry.sizeBytes} bytes</span>
            <span>prev {entry.prevHash?.slice(0, 12) ?? 'start'}</span>
            <span>hash {entry.hash.slice(0, 12)}</span>
            {entry.truncated && <span className="bad">truncated to 64 KB</span>}
            {broken && <span className="bad">chain broken here or before</span>}
          </div>
        </div>
      )}
    </li>
  );
}

function runOption(run: AuditRunSummary, index: number): string {
  return [`Run ${index + 1}`, run.role, run.model].filter(Boolean).join(' · ');
}

export function AuditLogs({
  runs,
  checks,
}: {
  runs: readonly AuditRunSummary[];
  checks: ChainChecks;
}) {
  const initial = runs.findLast((run) => run.logEntries > 0) ?? runs.at(-1);
  const [runId, setRunId] = useState(initial?.runId ?? '');
  const [direction, setDirection] = useState<ProtocolDirection | 'all'>('all');
  const [method, setMethod] = useState('');
  const [text, setText] = useState('');
  const q = useDebouncedValue(text, 250);
  const run = runs.find((candidate) => candidate.runId === runId);
  const filters: LogFilters = {
    direction: direction === 'all' ? null : direction,
    method: method || null,
    q,
  };
  const log = useInfiniteQuery({
    queryKey: auditKeys.log(runId, filters),
    queryFn: ({ pageParam }) => auditApi.log(runId, pageParam, filters),
    initialPageParam: 0,
    getNextPageParam: (page) => page.nextAfter ?? undefined,
    enabled: runId !== '',
  });
  if (!run) return <EmptyScene>No runs in this chat yet.</EmptyScene>;
  const entries = log.data?.pages.flatMap((page) => page.entries) ?? [];
  const check = checks.get(run.runId);
  const brokenFrom = check && !check.intact ? (check.firstBrokenSeq ?? 0) : Infinity;

  return (
    <>
      <div className="lf">
        <ChoicePicker
          label="Run"
          choices={runs.map((candidate, index) => ({
            id: candidate.runId,
            label: runOption(candidate, index),
          }))}
          value={runId}
          onChange={(id) => {
            setRunId(id);
            setMethod('');
          }}
        />
        <ChoicePicker
          label="Direction"
          choices={DIRECTIONS}
          value={direction}
          onChange={(id) => {
            const next = DIRECTIONS.find((option) => option.id === id);
            if (next) setDirection(next.id);
          }}
        />
        <ChoicePicker
          label="Method"
          choices={[
            { id: '', label: 'All methods' },
            ...run.methods.map((name) => ({ id: name, label: name })),
          ]}
          value={method}
          onChange={setMethod}
        />
        <input
          className="lf-q"
          type="search"
          placeholder="Filter by text"
          aria-label="Filter by text"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className="lbar">
        <BadgeView badge={runBadge(run, check)} />
        <span className="lcount" role="status">
          {log.isPending
            ? `${run.logEntries} messages`
            : `${entries.length}${log.hasNextPage ? '+' : ''} of ${run.logEntries} messages`}
        </span>
      </div>
      <QueryWait query={log} what="the messages">
        <Skeleton label="Reading the messages" shape="list" rows={6} />
      </QueryWait>
      {log.isSuccess && entries.length === 0 && (
        <p className="aud-empty">
          {run.logEntries === 0
            ? 'Nothing was recorded for this run.'
            : 'No messages match. Try another direction, method, or text.'}
        </p>
      )}
      <ul className="llist" aria-label="Protocol messages">
        {entries.map((entry) => (
          <LogRow key={entry.seq} entry={entry} broken={entry.seq >= brokenFrom} />
        ))}
      </ul>
      {log.isFetchingNextPage && <Skeleton label="Reading more messages" shape="list" rows={3} />}
      {log.hasNextPage && (
        <button
          type="button"
          className="btn line sm lmore"
          disabled={log.isFetchingNextPage}
          aria-busy={log.isFetchingNextPage}
          onClick={() => void log.fetchNextPage()}
        >
          Load more
        </button>
      )}
    </>
  );
}

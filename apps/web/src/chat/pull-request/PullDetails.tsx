import './pull-details.css';
import { useState, type ReactNode } from 'react';
import type { PrCheckRun, PrReviewer, PrThread, PrWatch } from '@spark-outpost/contracts';
import { relativeTime } from '../../ui/relative-time.ts';
import {
  checkRuns,
  otherChecksLine,
  reviewsLine,
  THREAD_CAP,
  threadWhere,
} from './pr-card-model.ts';

const CHECK_LABELS: Record<PrCheckRun['state'], string> = {
  failing: 'Failed',
  running: 'Running',
  passing: 'Passed',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
  neutral: 'Neutral',
};

const REVIEW_LABELS: Record<PrReviewer['state'], string> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  commented: 'Commented',
};

const THREAD_LABELS: Record<NonNullable<PrThread['status']>, string> = {
  fixed: 'Fixed',
  pushed_back: 'Pushed back',
  answered: 'Answered',
  needs_you: 'Left for you',
  fixing: 'Fixing',
};

function Outside({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <span className="prd-name">{children}</span>;
  return (
    <a className="prd-name" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

interface FoldProps {
  label: string;
  line: string;
  startOpen?: boolean;
  children: ReactNode;
}

function Fold({ label, line, startOpen = false, children }: FoldProps) {
  const [open, setOpen] = useState(startOpen);
  return (
    <details
      className="prd-fold"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="prd-label">{label}</span>
        <span className="prd-line">{line}</span>
      </summary>
      {children}
    </details>
  );
}

function CheckRow({ run }: { run: PrCheckRun }) {
  return (
    <li className="prd-row">
      <span className="prd-head">
        <Outside href={run.url}>{run.name}</Outside>
        <span className={`prd-state ${run.state}`}>{CHECK_LABELS[run.state]}</span>
      </span>
      {run.summary && <span className="prd-text">{run.summary}</span>}
    </li>
  );
}

function Checks({ watch }: { watch: PrWatch }) {
  const runs = checkRuns(watch);
  if (runs.length === 0 || watch.unknownReason) return null;
  const failing = runs.filter((run) => run.state === 'failing');
  const others = runs.filter((run) => run.state !== 'failing');
  return (
    <div className="prd-section">
      {failing.length > 0 && (
        <>
          <p className="prd-title">Failing checks</p>
          <ul aria-label={`Failing checks on #${watch.number}`}>
            {failing.map((run) => (
              <CheckRow key={run.name} run={run} />
            ))}
          </ul>
        </>
      )}
      {others.length > 0 && (
        <Fold label={failing.length > 0 ? 'Other checks' : 'Checks'} line={otherChecksLine(others)}>
          <ul aria-label={`Other checks on #${watch.number}`}>
            {others.map((run) => (
              <CheckRow key={run.name} run={run} />
            ))}
          </ul>
        </Fold>
      )}
    </div>
  );
}

function Reviews({ watch }: { watch: PrWatch }) {
  const { reviewers } = watch.details;
  if (reviewers.length === 0) return null;
  return (
    <Fold label="Reviews" line={reviewsLine(reviewers)}>
      <ul aria-label={`Reviews on #${watch.number}`}>
        {reviewers.map((reviewer) => (
          <li key={reviewer.user} className="prd-row">
            <span className="prd-head">
              <Outside href={reviewer.url}>{reviewer.user}</Outside>
              <span className={`prd-state ${reviewer.state}`}>{REVIEW_LABELS[reviewer.state]}</span>
              {reviewer.at && <span className="prd-when">{relativeTime(reviewer.at)}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Fold>
  );
}

function ThreadRow({ thread }: { thread: PrThread }) {
  return (
    <li className="prd-row">
      <span className="prd-head">
        <Outside href={thread.url}>{threadWhere(thread)}</Outside>
        {thread.status && (
          <span className={`prd-state ${thread.status}`}>{THREAD_LABELS[thread.status]}</span>
        )}
        {thread.at && <span className="prd-when">{relativeTime(thread.at)}</span>}
      </span>
      <span className="prd-text clamp">{thread.excerpt}</span>
    </li>
  );
}

function Comments({ watch }: { watch: PrWatch }) {
  const { threads, threadCount } = watch.details;
  const [all, setAll] = useState(false);
  if (threads.length === 0) return null;
  const waiting = threads.filter((thread) => thread.status === 'needs_you').length;
  const shown = all ? threads : threads.slice(0, THREAD_CAP);
  const line = `${threadCount} open${waiting > 0 ? ` · ${waiting} left for you` : ''}`;
  return (
    <Fold label="Comments" line={line} startOpen={waiting > 0}>
      <ul aria-label={`Open comments on #${watch.number}`}>
        {shown.map((thread) => (
          <ThreadRow key={thread.key} thread={thread} />
        ))}
      </ul>
      {threads.length > THREAD_CAP && (
        <button type="button" className="prd-more" onClick={() => setAll((value) => !value)}>
          {all ? 'Show fewer' : `Show all ${threads.length}`}
        </button>
      )}
      {all && threadCount > threads.length && (
        <p className="prd-rest">{threadCount - threads.length} more on GitHub.</p>
      )}
    </Fold>
  );
}

export function PullDetails({ watch }: { watch: PrWatch }) {
  return (
    <div className="prd">
      <Checks watch={watch} />
      <Reviews watch={watch} />
      <Comments watch={watch} />
    </div>
  );
}

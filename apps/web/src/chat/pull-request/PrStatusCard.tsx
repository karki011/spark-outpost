import './pr-status.css';
import { useQuery } from '@tanstack/react-query';
import {
  feedbackTriageLabels,
  type FeedbackItem,
  type PrChecks,
  type PrWatch,
} from '@spark-outpost/contracts';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { prFollowUpApi, prWatchesKey } from './pr-follow-up-api.ts';

const CHECKS: Record<PrChecks, string> = {
  none: 'No checks',
  pending: 'Checks running',
  passing: 'Checks passing',
  failing: 'Checks failing',
};

const STATE_LABELS: Record<FeedbackItem['state'], string> = {
  queued: 'Up next',
  held: 'Shown only',
  needs_user: 'Needs you',
  in_round: 'Fixing',
  planned: 'Waiting for you',
  done: 'Handled',
  skipped: 'Left out',
};

function prLabel(watch: PrWatch): string {
  if (watch.prState !== 'open') return watch.prState === 'merged' ? 'Merged' : 'Closed';
  return watch.draft ? 'Draft' : 'Open';
}

function commentsLabel(count: number): string {
  return `${count} new ${count === 1 ? 'comment' : 'comments'}`;
}

function itemWhere(item: FeedbackItem): string {
  if (item.kind === 'check') return `check from ${item.author}`;
  const place = item.path ? ` on ${item.path}${item.line ? `:${item.line}` : ''}` : '';
  return `${item.author}${place}`;
}

function Items({ items }: { items: FeedbackItem[] }) {
  return (
    <details className="prs-items">
      <summary>
        {items.length} {items.length === 1 ? 'item' : 'items'} gathered
      </summary>
      <ul>
        {items.map((item) => (
          <li key={item.id} className={`prs-item ${item.state}`}>
            <span className="prs-label">{item.label}</span>
            <span className="prs-triage">{feedbackTriageLabels[item.triage]}</span>
            <span className="prs-text">
              {itemWhere(item)}
              {!item.trusted && (
                <span className="prs-untrusted"> · can’t write to the repo</span>
              )}: {item.excerpt}
            </span>
            <span className="prs-state">{STATE_LABELS[item.state]}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function WatchCard({ watch }: { watch: PrWatch }) {
  const facts = [
    prLabel(watch),
    CHECKS[watch.checks],
    commentsLabel(watch.newComments),
    `Round ${watch.rounds} of ${watch.maxRounds}`,
  ];
  return (
    <section
      className={`prs ${watch.phase}`}
      aria-label={`Pull request ${watch.repo}#${watch.number}`}
    >
      <div className="prs-head">
        <span className="prs-tag">PR</span>
        <a href={watch.url} target="_blank" rel="noreferrer" className="prs-link">
          {watch.repo}#{watch.number}
        </a>
        <span className="prs-facts">{facts.join(' · ')}</span>
      </div>
      <p className="prs-doing" role="status">
        <span className="prs-who">Spark:</span> {watch.doing}
        {watch.approvalId && (
          <>
            {' '}
            <a className="prs-review" href={`#${approvalAnchor(watch.approvalId)}`}>
              Review the card
            </a>
          </>
        )}
      </p>
      {watch.lastError && <p className="prs-error">Last check failed: {watch.lastError}</p>}
      {watch.items.length > 0 && <Items items={watch.items} />}
    </section>
  );
}

export function PrStatusCard({ conversationId }: { conversationId: string }) {
  const watches = useQuery({
    queryKey: prWatchesKey(conversationId),
    queryFn: () => prFollowUpApi.get(conversationId),
  });
  const list = watches.data?.watches ?? [];
  const open = list.filter((watch) => watch.phase !== 'done');
  const shown = open.length > 0 ? open : list.slice(0, 1);
  if (shown.length === 0) return null;
  return (
    <div className="prs-wrap">
      {shown.map((watch) => (
        <WatchCard key={watch.id} watch={watch} />
      ))}
    </div>
  );
}

import {
  feedbackTriageLabels,
  type FeedbackItem,
  type Profile,
  type PrWatch,
} from '@spark-outpost/contracts';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { BranchIcon } from '../../ui/icons.tsx';
import { providerName } from '../provider-name.ts';
import { PullDetails } from './PullDetails.tsx';
import {
  branchLine,
  CI_LABELS,
  ciState,
  openedLine,
  PULL_STATE_LABELS,
  pullState,
} from './pull-request-model.ts';
import type { WatchIndicator } from './watch-indicator-model.ts';
import { WatchDetail } from './WatchIndicator.tsx';

const STATE_LABELS: Record<FeedbackItem['state'], string> = {
  queued: 'Up next',
  held: 'Not acted on',
  needs_user: 'Needs you',
  in_round: 'Fixing',
  planned: 'Waiting for you',
  done: 'Handled',
  skipped: 'Left out',
};

const isBotAuthor = (author: string) => author.endsWith('[bot]');

function itemWhere(item: FeedbackItem): string {
  if (item.kind === 'check') return `check from ${item.author}`;
  const place = item.path ? ` on ${item.path}${item.line ? `:${item.line}` : ''}` : '';
  return `${item.author}${place}`;
}

function Items({ items }: { items: FeedbackItem[] }) {
  const waiting = items.some((item) => item.state === 'needs_user');
  return (
    <details className="prc-items" open={waiting || undefined}>
      <summary>
        {items.length} {items.length === 1 ? 'item' : 'items'} gathered
      </summary>
      <ul>
        {items.map((item) => (
          <li key={item.id} className={`prc-gathered ${item.state}`}>
            <span className="prc-tag">{item.label}</span>
            <span className="prc-triage">{feedbackTriageLabels[item.triage]}</span>
            <span className="prc-text">
              {itemWhere(item)}
              {!item.trusted && !isBotAuthor(item.author) && (
                <span className="prc-untrusted"> · no write access</span>
              )}
              : {item.excerpt}
            </span>
            <span className="prc-kept">{STATE_LABELS[item.state]}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function factsLine(watch: PrWatch): string {
  const comments = `${watch.newComments} new ${watch.newComments === 1 ? 'comment' : 'comments'}`;
  return [
    PULL_STATE_LABELS[pullState(watch)],
    CI_LABELS[ciState(watch)],
    comments,
    ...(watch.followUp ? [`Round ${watch.rounds}`] : []),
  ].join(' · ');
}

interface PullPanelProps {
  watch: PrWatch;
  indicator: WatchIndicator | null;
  profile: Profile | null;
  onOpenLinks: (() => void) | null;
}

export function PullPanel({ watch, indicator, profile, onOpenLinks }: PullPanelProps) {
  const branch = branchLine(watch);
  const covered = indicator?.state === 'no_access' || indicator?.state === 'paused';
  const showDoing = !(covered || indicator?.state === 'off');
  const note = covered
    ? null
    : watch.unknownReason
      ? { text: watch.unknownReason, bad: false }
      : watch.lastError
        ? { text: `Last check failed: ${watch.lastError}`, bad: true }
        : null;
  return (
    <>
      <header className="prc-full">
        {watch.title && <p className="prc-heading">{watch.title}</p>}
        <p className="prc-all">
          <a href={watch.url} target="_blank" rel="noopener noreferrer">
            {watch.repo}#{watch.number}
          </a>
          <span>{factsLine(watch)}</span>
        </p>
      </header>
      {(indicator || showDoing || note) && (
        <section className="prc-status" aria-label="What Spark is doing">
          {indicator && <WatchDetail indicator={indicator} profile={profile} />}
          {showDoing && (
            <p className="prc-doing">
              <span className="prc-who">Spark:</span> {watch.doing}
              {watch.approvalId && (
                <>
                  {' '}
                  <a href={`#${approvalAnchor(watch.approvalId)}`}>Review the card</a>
                </>
              )}
            </p>
          )}
          {note && <p className={note.bad ? 'prc-note bad' : 'prc-note'}>{note.text}</p>}
        </section>
      )}
      {watch.items.length > 0 && <Items items={watch.items} />}
      <PullDetails watch={watch} />
      <p className="prc-meta">
        {branch && (
          <span className="prc-branch">
            <BranchIcon />
            {branch}
          </span>
        )}
        <span>{openedLine(watch.opened, providerName)}</span>
        {onOpenLinks && (
          <button type="button" className="prc-links" onClick={onOpenLinks}>
            Show in Links
          </button>
        )}
      </p>
    </>
  );
}

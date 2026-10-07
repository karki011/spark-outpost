import './pull-requests.css';
import type { PrWatch } from '@spark-outpost/contracts';
import { GitHubIcon } from '../../tasks/TaskIcons.tsx';
import { BranchIcon } from '../../ui/icons.tsx';
import { providerName } from '../provider-name.ts';
import {
  branchLine,
  CI_LABELS,
  CI_TONES,
  ciState,
  groupByRepo,
  openedLine,
  PULL_STATE_LABELS,
  pullState,
  reviewLabel,
  type Tone,
} from './pull-request-model.ts';
import { PullDetails } from './PullDetails.tsx';
import { useWatchContext, type WatchContext } from './use-watch-context.ts';
import { watchIndicator } from './watch-indicator-model.ts';
import { WatchDetail } from './WatchIndicator.tsx';

const PILLS: Record<Tone, string> = {
  ok: 'spill ok',
  prog: 'spill prog',
  bad: 'spill bad',
  plain: 'spill',
};

interface PullRequestRowProps {
  watch: PrWatch;
  context: WatchContext;
}

function PullRequestRow({ watch, context }: PullRequestRowProps) {
  const indicator = watchIndicator(watch, context.contextFor(watch.roundRunId));
  const ci = ciState(watch);
  const state = pullState(watch);
  const review = reviewLabel(watch);
  const branch = branchLine(watch);
  const neverRead = watch.unknownReason !== null && watch.title === null;
  return (
    <li className="prl-item">
      <a className="prl-title" href={watch.url} target="_blank" rel="noopener noreferrer">
        <GitHubIcon />
        <b>
          <span className="prl-number">#{watch.number}</span> {watch.title ?? 'Pull request'}
        </b>
      </a>
      <p className="prl-facts">
        {neverRead ? null : <span className="spill">{PULL_STATE_LABELS[state]}</span>}
        <span className={PILLS[CI_TONES[ci]]}>{CI_LABELS[ci]}</span>
        {review && <span>{review}</span>}
      </p>
      {indicator && <WatchDetail indicator={indicator} profile={context.profile} />}
      <PullDetails watch={watch} />
      {watch.unknownReason && indicator?.state !== 'no_access' && (
        <p className="prl-note">{watch.unknownReason}</p>
      )}
      <p className="prl-meta">
        {branch && (
          <span className="prl-branch">
            <BranchIcon />
            {branch}
          </span>
        )}
        <span>{openedLine(watch.opened, providerName)}</span>
      </p>
    </li>
  );
}

interface PullRequestListProps {
  conversationId: string;
  watches: readonly PrWatch[];
}

export function PullRequestList({ conversationId, watches }: PullRequestListProps) {
  if (watches.length === 0) return null;
  return <PullRequestGroups conversationId={conversationId} watches={watches} />;
}

function PullRequestGroups({ conversationId, watches }: PullRequestListProps) {
  const context = useWatchContext(conversationId);
  return (
    <section className="prl" aria-label="Pull requests">
      {groupByRepo(watches).map((group) => (
        <div key={group.repo} className="prl-group">
          <h3 className="prl-repo">
            {group.repo}
            {group.outside && <span className="prl-outside">outside</span>}
          </h3>
          <ul aria-label={`Pull requests in ${group.repo}`}>
            {group.pulls.map((watch) => (
              <PullRequestRow key={watch.id} watch={watch} context={context} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

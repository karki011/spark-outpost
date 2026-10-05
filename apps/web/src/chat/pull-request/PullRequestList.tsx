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

const PILLS: Record<Tone, string> = {
  ok: 'spill ok',
  prog: 'spill prog',
  bad: 'spill bad',
  plain: 'spill',
};

function FailingChecks({ watch }: { watch: PrWatch }) {
  if (ciState(watch) !== 'failing' || watch.failingChecks.length === 0) return null;
  return (
    <div className="prl-failing">
      <span>Failing:</span>
      <ul aria-label={`Failing checks on #${watch.number}`}>
        {watch.failingChecks.map((check) => (
          <li key={check.name}>
            {check.url ? (
              <a href={check.url} target="_blank" rel="noopener noreferrer">
                {check.name}
              </a>
            ) : (
              check.name
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PullRequestRow({ watch }: { watch: PrWatch }) {
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
      <FailingChecks watch={watch} />
      {watch.unknownReason && <p className="prl-note">{watch.unknownReason}</p>}
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

export function PullRequestList({ watches }: { watches: readonly PrWatch[] }) {
  if (watches.length === 0) return null;
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
              <PullRequestRow key={watch.id} watch={watch} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

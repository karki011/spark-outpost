import { ExternalLinkIcon, LockIcon } from '../ui/icons.tsx';
import type { PullMark } from './story-bar.ts';
import { isOpenPull, type OutpostPull } from './outpost-pulls.ts';
import { webLink } from './post-text.ts';

const MARK_LABELS: Record<PullMark, string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
};

function PullList({ title, pulls }: { title: string; pulls: readonly OutpostPull[] }) {
  if (pulls.length === 0) return null;
  return (
    <section className="op-group">
      <h3>
        {title}
        <span className="op-group-count">{pulls.length}</span>
      </h3>
      <ul>
        {pulls.map((pull) => (
          <li key={pull.url}>
            <a className="op-trow" href={webLink(pull.url)} target="_blank" rel="noreferrer">
              <ExternalLinkIcon />
              <span className="op-trow-text">
                <b>{pull.number === null ? 'Pull request' : `Pull request #${pull.number}`}</b>
                <span className="op-trow-sub">@{pull.handle}</span>
              </span>
              <span className="op-pill">{MARK_LABELS[pull.state]}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PullsTab({ pulls }: { pulls: readonly OutpostPull[] }) {
  if (pulls.length === 0) {
    return <p className="op-pane-empty">No pull requests yet.</p>;
  }
  return (
    <div className="op-groups">
      <PullList title="Open" pulls={pulls.filter(isOpenPull)} />
      <PullList title="Merged or closed" pulls={pulls.filter((pull) => !isOpenPull(pull))} />
      <p className="op-rule">
        <LockIcon />
        <span>Spark never merges. Review each pull request on GitHub.</span>
      </p>
    </div>
  );
}

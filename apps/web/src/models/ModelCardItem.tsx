import { useId, useState } from 'react';
import type { ModelCardView } from '@spark-outpost/contracts';
import { formatPrice, formatTokenCount, statLines } from './model-card-stats.ts';
import { ModelBlob } from './ModelBlob.tsx';
import {
  benchmarkBadge,
  effortRange,
  metaLine,
  modelTag,
  retirementDetail,
  roleLine,
  usedBySpark,
} from './model-list.ts';

function Meta({ view }: { view: ModelCardView }) {
  const { card } = view;
  const [price, context, speed] = metaLine(card);
  const priceTitle = card.price
    ? `${formatPrice(card.price.inputPerMillion)} in · ${formatPrice(card.price.cachedInputPerMillion)} cached · ${formatPrice(card.price.outputPerMillion)} out per million tokens`
    : undefined;
  return (
    <p className="mc-meta">
      <span title={priceTitle}>{price}</span>
      <span aria-hidden="true">·</span>
      <span title={`${formatTokenCount(card.maxOutputTokens)} max output`}>{context}</span>
      <span aria-hidden="true">·</span>
      <span>{speed}</span>
    </p>
  );
}

function Badge({ view }: { view: ModelCardView }) {
  const badge = benchmarkBadge(view);
  if (!badge) return <span className="mc-badge none">Not benchmarked</span>;
  return (
    <span className={badge.anecdotal ? 'mc-badge warn' : 'mc-badge'} title={badge.detail}>
      {badge.text}
      <span className="sr-only">
        {`, ${badge.detail}`}
        {badge.anecdotal && ', anecdotal'}
      </span>
    </span>
  );
}

function StaleNote({ view }: { view: ModelCardView }) {
  const { staleness } = view;
  const note = staleness.factsExpired
    ? 'Facts are over 120 days old: Jev no longer sees its price'
    : staleness.checkStale
      ? `Checked ${staleness.checkedDaysAgo} days ago`
      : null;
  if (!note) return null;
  return (
    <p className="mc-warns" role="note">
      <span className="mc-tag warn">{note}</span>
    </p>
  );
}

function Measured({ view }: { view: ModelCardView }) {
  const lines = statLines(view.stats);
  if (lines.length === 0) return null;
  return (
    <table className="mc-stats">
      <caption>Measured on our benchmark</caption>
      <thead>
        <tr>
          <th scope="col">Work</th>
          <th scope="col">Passed</th>
          <th scope="col">Mean cost</th>
          <th scope="col">Mean time</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.key}>
            <th scope="row">
              {line.label}
              {line.anecdotal && <span className="mc-tag warn">anecdotal</span>}
            </th>
            <td>
              {line.passed}/{line.n}
            </td>
            <td>
              {line.estimated ? '~' : ''}${line.meanCostUsd.toFixed(3)}
            </td>
            <td>{(line.meanWallMs / 1000).toFixed(1)} s</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Sources({ view }: { view: ModelCardView }) {
  const { card } = view;
  return (
    <p className="mc-sources">
      Sources:{' '}
      {card.sources.map((source, index) => (
        <span key={source.url}>
          {index > 0 && ', '}
          {source.url.startsWith('http') ? (
            <a href={source.url} target="_blank" rel="noreferrer">
              {new URL(source.url).pathname.split('/').filter(Boolean).at(-1) ?? source.url}
            </a>
          ) : (
            <code>{source.url}</code>
          )}
        </span>
      ))}{' '}
      · checked {card.sources[0]?.checkedAt}
    </p>
  );
}

function Details({ view, id, open }: { view: ModelCardView; id: string; open: boolean }) {
  const { card } = view;
  const defaultEffort = card.reasoning.defaultEffort;
  const retirement = retirementDetail(card);
  return (
    <div className="mc-details" id={id} hidden={!open}>
      <p className="mc-extra">
        Effort {effortRange(card)}
        {defaultEffort && ` (default ${defaultEffort})`}
        {retirement && ` · ${retirement}`}
      </p>
      <div className="mc-lists">
        <div>
          <h6>Good at</h6>
          <ul>
            {card.strengths.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div>
          <h6>Watch out for</h6>
          <ul>
            {card.weakSpots.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
      <Measured view={view} />
      <details className="mc-more">
        <summary>What Jev reads</summary>
        <p>
          <code>{view.jevText}</code> <small>{view.jevText.length} of 160 characters</small>
        </p>
      </details>
      <Sources view={view} />
    </div>
  );
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m6 9 6 6 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ModelCardItem({ view }: { view: ModelCardView }) {
  const { card } = view;
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const headingId = `mc-${card.id.replace(/[^a-z0-9]+/gi, '-')}`;
  const role = roleLine(view);
  const tag = modelTag(view);
  const quiet = !usedBySpark(view);
  const classes = ['mc-card', quiet && 'quiet', open && 'open'].filter(Boolean).join(' ');
  return (
    <li className={classes} aria-labelledby={headingId}>
      <div className="mc-head">
        <ModelBlob provider={card.provider} tier={card.tier} retiring={view.staleness.retiring} />
        <h5 id={headingId}>{card.label}</h5>
        <span className={`mc-tier ${card.tier}`}>{card.tier} tier</span>
        {view.isDefault && <span className="mc-tag">default</span>}
        {!view.offered && <span className="mc-tag">not offered</span>}
      </div>
      <p className="mc-role">
        {role}
        {tag && <span className={quiet ? 'mc-tag' : 'mc-tag warn'}>{tag}</span>}
      </p>
      <Meta view={view} />
      <StaleNote view={view} />
      <div className="mc-foot">
        <button
          type="button"
          className="mc-toggle"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((value) => !value)}
        >
          Details
          <Chevron />
        </button>
        <Badge view={view} />
      </div>
      <Details view={view} id={detailsId} open={open} />
    </li>
  );
}

import { useId, useState } from 'react';
import type { ModelCardView } from '@spark-outpost/contracts';
import { formatPrice, formatTokenCount, statLines } from './model-card-stats.ts';
import {
  benchmarkHeadline,
  effortRange,
  retirementNote,
  shortPrice,
  tierNote,
} from './model-list.ts';

function Facts({ view }: { view: ModelCardView }) {
  const { card } = view;
  const defaultEffort = card.reasoning.defaultEffort;
  const priceTitle = card.price
    ? `${formatPrice(card.price.inputPerMillion)} in · ${formatPrice(card.price.cachedInputPerMillion)} cached · ${formatPrice(card.price.outputPerMillion)} out per million tokens`
    : undefined;
  return (
    <dl className="mc-facts">
      <div>
        <dt>Speed</dt>
        <dd>{card.speed}</dd>
      </div>
      <div>
        <dt>Price</dt>
        <dd title={priceTitle}>{shortPrice(card)}</dd>
      </div>
      <div>
        <dt>Context</dt>
        <dd title={`${formatTokenCount(card.maxOutputTokens)} max output`}>
          {formatTokenCount(card.contextTokens)}
        </dd>
      </div>
      <div>
        <dt>Effort</dt>
        <dd title={defaultEffort ? `default ${defaultEffort}` : undefined}>{effortRange(card)}</dd>
      </div>
    </dl>
  );
}

function Headline({ view }: { view: ModelCardView }) {
  const headline = benchmarkHeadline(view);
  if (!headline) {
    return <p className="mc-headline none">No benchmark runs yet: Jev sees vendor facts only.</p>;
  }
  return (
    <p className="mc-headline">
      <span className="mc-headline-text" title={headline.text}>
        {headline.text}
      </span>
      {headline.anecdotal && <span className="mc-tag warn">anecdotal</span>}
    </p>
  );
}

function Warnings({ view }: { view: ModelCardView }) {
  const { staleness } = view;
  const retirement = retirementNote(view);
  const notes = [
    ...(retirement ? [retirement] : []),
    ...(staleness.factsExpired
      ? ['Facts are over 120 days old: Jev no longer sees its price']
      : staleness.checkStale
        ? [`Checked ${staleness.checkedDaysAgo} days ago`]
        : []),
  ];
  if (notes.length === 0) return null;
  return (
    <p className="mc-warns" role="note">
      {notes.map((note) => (
        <span key={note} className="mc-tag warn">
          {note}
        </span>
      ))}
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
  return (
    <div className="mc-details" id={id} hidden={!open}>
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
  const note = tierNote(card.tier);
  return (
    <li className={open ? 'mc-card open' : 'mc-card'} aria-labelledby={headingId}>
      <div className="mc-head">
        <h5 id={headingId}>{card.label}</h5>
        <span className={`mc-tier ${card.tier}`}>{card.tier} tier</span>
        {view.isDefault && <span className="mc-tag">default</span>}
        {!view.offered && <span className="mc-tag">not offered</span>}
      </div>
      {note && <p className="mc-note">{note}</p>}
      <Facts view={view} />
      <Headline view={view} />
      <Warnings view={view} />
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
      <Details view={view} id={detailsId} open={open} />
    </li>
  );
}

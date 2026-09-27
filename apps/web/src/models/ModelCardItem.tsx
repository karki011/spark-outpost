import type { ModelCardView } from '@spark-outpost/contracts';
import { formatPrice, formatTokenCount, statLines } from './model-card-stats.ts';

function Facts({ view }: { view: ModelCardView }) {
  const { card } = view;
  const efforts = card.reasoning.efforts.length > 0 ? card.reasoning.efforts.join(', ') : 'none';
  const price = card.price
    ? `${formatPrice(card.price.inputPerMillion)} in · ${formatPrice(card.price.cachedInputPerMillion)} cached · ${formatPrice(card.price.outputPerMillion)} out per million tokens`
    : 'No price listed';
  return (
    <dl className="mc-facts">
      <dt>Speed</dt>
      <dd>{card.speed}</dd>
      <dt>Price</dt>
      <dd>{price}</dd>
      <dt>Context</dt>
      <dd>
        {formatTokenCount(card.contextTokens)} in, {formatTokenCount(card.maxOutputTokens)} out
      </dd>
      <dt>Effort</dt>
      <dd>
        {efforts}
        {card.reasoning.defaultEffort && ` (default ${card.reasoning.defaultEffort})`}
      </dd>
    </dl>
  );
}

function Measured({ view }: { view: ModelCardView }) {
  const lines = statLines(view.stats);
  if (lines.length === 0) {
    return <p className="mc-none">No benchmark runs yet: Jev sees vendor facts only.</p>;
  }
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
              {line.anecdotal && <span className="mc-tag">anecdotal</span>}
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

function Staleness({ view }: { view: ModelCardView }) {
  const { staleness, card } = view;
  const notes = [
    ...(staleness.retiring ? [`Past its retirement date (${card.retiresNotBefore})`] : []),
    ...(staleness.factsExpired
      ? ['Facts are over 120 days old: Jev no longer sees its price']
      : staleness.checkStale
        ? [`Checked ${staleness.checkedDaysAgo} days ago`]
        : []),
  ];
  if (notes.length === 0) return null;
  return (
    <p className="mc-warn" role="note">
      {notes.join(' · ')}
    </p>
  );
}

export function ModelCardItem({ view }: { view: ModelCardView }) {
  const { card } = view;
  const headingId = `mc-${card.id.replace(/[^a-z0-9]+/gi, '-')}`;
  return (
    <li className="mc-card" aria-labelledby={headingId}>
      <div className="mc-head">
        <h5 id={headingId}>{card.label}</h5>
        <span className={card.tier === 'frontier' ? 'mc-tier frontier' : 'mc-tier'}>
          {card.tier} tier
        </span>
        {view.isDefault && <span className="mc-tag">default</span>}
        {!view.offered && <span className="mc-tag">not offered</span>}
      </div>
      <Staleness view={view} />
      <Facts view={view} />
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
      <details className="mc-jev">
        <summary>What Jev reads</summary>
        <p>
          <code>{view.jevText}</code> <small>{view.jevText.length} of 160 characters</small>
        </p>
      </details>
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
    </li>
  );
}

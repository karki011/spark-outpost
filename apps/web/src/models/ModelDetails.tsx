import type { ModelCardView } from '@spark-outpost/contracts';
import { statLines } from './model-card-stats.ts';
import { benchmarkBadge, modelFacts, staleNote } from './model-list.ts';

function Facts({ view }: { view: ModelCardView }) {
  const badge = benchmarkBadge(view);
  return (
    <dl className="mc-facts">
      {modelFacts(view.card).map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
      <div>
        <dt>Benchmark</dt>
        <dd>
          {badge ? (
            <>
              <span className={badge.anecdotal ? 'mc-badge warn' : 'mc-badge'}>{badge.text}</span>{' '}
              {badge.detail}
              {badge.anecdotal && ', anecdotal'}
            </>
          ) : (
            'Not benchmarked'
          )}
        </dd>
      </div>
    </dl>
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

export function ModelDetails({ view }: { view: ModelCardView }) {
  const { card } = view;
  const stale = staleNote(view);
  return (
    <div className="mc-details">
      {stale && (
        <p className="mc-warn" role="note">
          {stale.full}
        </p>
      )}
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

import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GithubInboxItem, GithubPullDetails } from '@spark-outpost/contracts';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import { ChevronIcon } from '../ui/icons.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { githubApi, githubKeys } from './github-api.ts';

const LONG_LINES = 14;
const LONG_CHARS = 1_200;

function isLong(body: string): boolean {
  return body.length > LONG_CHARS || body.split('\n').length > LONG_LINES;
}

function Description({ details }: { details: GithubPullDetails }) {
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);
  const body = details.body.trim();
  if (!body) return <p className="gh-quiet">No description.</p>;
  const long = isLong(body);
  return (
    <>
      <div id={bodyId} className="gh-body" data-collapsed={long && !expanded ? '' : undefined}>
        <Markdown text={body} />
        {details.bodyCut && <p className="gh-quiet">The rest is on GitHub.</p>}
      </div>
      {long && (
        <button
          type="button"
          className="gh-more-btn"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Show less' : 'Show more'}
          <ChevronIcon />
        </button>
      )}
    </>
  );
}

function Files({ details }: { details: GithubPullDetails }) {
  if (details.filesTotal === 0) return null;
  const more = details.filesTotal - details.files.length;
  return (
    <details className="gh-files">
      <summary>
        <ChevronIcon />
        Changed files · {details.filesTotal}
      </summary>
      <ul aria-label="Changed files">
        {details.files.map((file) => (
          <li key={file.path}>
            <span className="gh-file-path" title={file.path}>
              {file.path}
            </span>
            <span className="gh-file-size">
              <span className="gh-add">+{file.additions}</span>{' '}
              <span className="gh-del">−{file.deletions}</span>
            </span>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="gh-quiet">{more} more on GitHub.</p>}
    </details>
  );
}

export function PullDetails({ item }: { item: GithubInboxItem }) {
  const details = useQuery({
    queryKey: githubKeys.details(item.id, item.headSha),
    queryFn: () => githubApi.details(item.id),
    staleTime: 60_000,
  });
  return (
    <>
      <section className="gh-sec" aria-labelledby="gh-desc-title">
        <h4 id="gh-desc-title">Description</h4>
        {details.isPending ? (
          <Skeleton label="Loading the description" shape="lines" rows={3} />
        ) : details.error ? (
          <p className="gh-quiet" role="alert">
            {details.error.message}
          </p>
        ) : (
          <Description key={item.id} details={details.data} />
        )}
      </section>
      {details.data && <Files details={details.data} />}
    </>
  );
}

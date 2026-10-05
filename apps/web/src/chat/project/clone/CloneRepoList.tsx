import { useState } from 'react';
import type { CloneOptions } from '@spark-outpost/contracts';
import { FolderIcon } from '../../../ui/icons.tsx';
import { Skeleton } from '../../../ui/loading/Skeleton.tsx';
import { matchingRepos } from './clone-form.ts';

const SHOWN = 50;

interface CloneRepoListProps {
  options: CloneOptions | undefined;
  loading: boolean;
  selectedUrl: string;
  onPick: (url: string) => void;
  onConnect: () => void;
}

export function CloneRepoList({
  options,
  loading,
  selectedUrl,
  onPick,
  onConnect,
}: CloneRepoListProps) {
  const [search, setSearch] = useState('');
  if (loading) return <Skeleton label="Loading your repositories" shape="list" rows={3} />;
  if (!options) return null;
  if (!options.connected) {
    return (
      <p className="clone-connect">
        To pick from your repositories,{' '}
        <button type="button" className="clone-link" onClick={onConnect}>
          connect GitHub
        </button>
        . You can still paste an address below.
      </p>
    );
  }
  const shown = matchingRepos(options.repos, search, SHOWN);
  const hiddenCount = matchingRepos(options.repos, search, Infinity).length - shown.length;
  return (
    <div className="clone-repos">
      <input
        type="search"
        className="inp"
        aria-label="Search repositories"
        placeholder="Search your repositories"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {options.listError && (
        <p className="fdlg-note bad" role="alert">
          {options.listError}
        </p>
      )}
      <ul className="clone-repo-list" aria-label="Repositories">
        {shown.map((repo) => (
          <li key={repo.url}>
            <button
              type="button"
              className="fdlg-row"
              aria-pressed={repo.url === selectedUrl.trim()}
              onClick={() => onPick(repo.url)}
            >
              <FolderIcon />
              <span>{repo.slug}</span>
            </button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && !options.listError && (
        <p className="fdlg-note">
          {options.repos.length === 0
            ? 'Spark has no repositories from GitHub yet. Paste an address below.'
            : 'No repositories match.'}
        </p>
      )}
      {(hiddenCount > 0 || options.truncated) && (
        <p className="fdlg-note">
          {hiddenCount > 0
            ? `${hiddenCount} more. Search to narrow the list.`
            : 'Only the first repositories are listed. Paste an address for any other.'}
        </p>
      )}
    </div>
  );
}

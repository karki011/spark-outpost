import type { RefObject } from 'react';
import type { GithubInboxWindowDays } from '@spark-outpost/contracts';
import { Glyph } from '../tickets/ticket-icons.tsx';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { RefreshIcon, XIcon } from '../ui/icons.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { AutoReviewChip } from './AutoReviewChip.tsx';

interface GithubHeaderProps {
  connected: boolean;
  windowDays: GithubInboxWindowDays;
  projects: readonly { id: string; name: string }[];
  projectId: string;
  fetchedAt: string | null;
  refreshing: boolean;
  now: number;
  onWindow: (days: GithubInboxWindowDays) => void;
  onProject: (projectId: string) => void;
  onRefresh: () => void;
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onQuery: (query: string) => void;
}

function SearchField({
  query,
  searchRef,
  onQuery,
}: Pick<GithubHeaderProps, 'query' | 'searchRef' | 'onQuery'>) {
  return (
    <div className="gh-find">
      <Glyph name="search" size={15} />
      <input
        ref={searchRef}
        type="search"
        value={query}
        aria-label="Search pull requests"
        placeholder="Search pull requests"
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && query) {
            event.preventDefault();
            onQuery('');
          }
        }}
      />
      {query ? (
        <button
          type="button"
          className="icon-btn"
          aria-label="Clear search"
          onClick={() => {
            onQuery('');
            searchRef.current?.focus();
          }}
        >
          <XIcon />
        </button>
      ) : (
        <kbd className="kbd" aria-hidden="true">
          /
        </kbd>
      )}
    </div>
  );
}

const WINDOWS = [
  { id: '14', label: 'Last 14 days' },
  { id: '30', label: 'Last 30 days' },
];

export function GithubHeader(props: GithubHeaderProps) {
  return (
    <header className="gh-head">
      <h2 id="gh-title">GitHub</h2>
      {props.connected && (
        <SearchField query={props.query} searchRef={props.searchRef} onQuery={props.onQuery} />
      )}
      <span className="gh-sp" />
      {props.connected && (
        <div className="gh-controls">
          <span className="gh-synced" role="status">
            {props.refreshing
              ? 'Refreshing…'
              : props.fetchedAt
                ? `Updated ${relativeTime(props.fetchedAt, props.now)}`
                : ''}
          </span>
          <AutoReviewChip />
          <div className="gh-pick">
            <ChoicePicker
              label="Time window"
              value={String(props.windowDays)}
              choices={WINDOWS}
              onChange={(id) => props.onWindow(id === '30' ? 30 : 14)}
            />
          </div>
          <div className={props.projectId ? 'gh-pick on' : 'gh-pick'}>
            <ChoicePicker
              label="Project"
              menuClassName="gh-project-menu"
              value={props.projectId}
              choices={[
                { id: '', label: 'All projects' },
                ...props.projects.map((project) => ({ id: project.id, label: project.name })),
              ]}
              onChange={props.onProject}
            />
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Refresh pull requests"
            title="Refresh pull requests"
            disabled={props.refreshing}
            onClick={props.onRefresh}
          >
            <RefreshIcon />
          </button>
        </div>
      )}
    </header>
  );
}

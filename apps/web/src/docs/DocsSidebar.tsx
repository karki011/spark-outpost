import { useEffect, useMemo, useRef, type KeyboardEvent, type RefObject } from 'react';
import {
  GUIDE_TYPE_LABELS,
  guideLink,
  searchGuidePages,
  type GuidePage,
} from '@spark-outpost/contracts';
import { SearchIcon, XIcon } from '../ui/icons.tsx';
import { openDoc } from './doc-route.ts';
import type { DocsNavOpen } from './DocsBar.tsx';
import { DocsNav, type DocsNavMemory } from './DocsNav.tsx';
import { recordMissedSearch } from './missed-searches.ts';

const MISSED_SEARCH_SETTLE_MS = 1_500;

interface DocsSidebarProps {
  pages: readonly GuidePage[];
  current: string;
  query: string;
  navOpen: DocsNavOpen;
  onQuery: (query: string) => void;
  onClose: () => void;
  onPicked: () => void;
}

function DocsSearchBox({
  query,
  onQuery,
  onSubmit,
  onArrowDown,
}: {
  query: string;
  onQuery: (query: string) => void;
  onSubmit: () => void;
  onArrowDown: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSubmit();
    }
    if (event.key === 'ArrowDown' && query) {
      event.preventDefault();
      onArrowDown();
    }
    if (event.key === 'Escape' && query) {
      event.stopPropagation();
      onQuery('');
    }
  };
  return (
    <label className="docs-find">
      <SearchIcon />
      <input
        ref={input}
        type="search"
        value={query}
        placeholder="What do you want to do?"
        aria-label="Search the guide"
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {query && (
        <button
          type="button"
          className="docs-find-clear"
          aria-label="Clear search"
          onClick={() => {
            onQuery('');
            input.current?.focus();
          }}
        >
          <XIcon />
        </button>
      )}
    </label>
  );
}

function SearchResults({
  pages,
  query,
  list,
  onPicked,
  onLeaveTop,
}: {
  pages: readonly GuidePage[];
  query: string;
  list: RefObject<HTMLDivElement | null>;
  onPicked: () => void;
  onLeaveTop: () => void;
}) {
  const hits = useMemo(() => searchGuidePages(pages, query), [pages, query]);
  const missed = hits.length === 0;
  useEffect(() => {
    if (!missed) return;
    const timer = window.setTimeout(() => recordMissedSearch(query), MISSED_SEARCH_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [missed, query]);
  const onResultKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const links = [...event.currentTarget.querySelectorAll<HTMLElement>('a')];
    const next =
      links.indexOf(document.activeElement as HTMLElement) + (event.key === 'ArrowDown' ? 1 : -1);
    if (next < 0) onLeaveTop();
    else links[Math.min(next, links.length - 1)]?.focus();
  };
  return (
    <div className="docs-results" ref={list}>
      <p className="docs-results-count" role="status">
        {hits.length === 0
          ? `No pages match “${query.trim()}”.`
          : `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`}
      </p>
      {missed && (
        <p className="docs-results-hint">
          Try fewer words, the name of a button or card, or{' '}
          <a href={guideLink(pages[0]!.slug)} onClick={onPicked}>
            browse by task
          </a>
          .
        </p>
      )}
      {hits.length > 0 && (
        <ul aria-label="Search results" onKeyDown={onResultKey}>
          {hits.map((hit) => (
            <li key={hit.slug}>
              <a href={guideLink(hit.slug, hit.anchor)} onClick={onPicked}>
                <b>{hit.title}</b>
                <span className="docs-hit-meta">
                  <span className="docs-type" data-type={hit.type}>
                    {GUIDE_TYPE_LABELS[hit.type]}
                  </span>
                  {hit.heading ?? hit.section}
                </span>
                <span className="docs-hit-snippet">{hit.snippet}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DocsSidebar({
  pages,
  current,
  query,
  navOpen,
  onQuery,
  onClose,
  onPicked,
}: DocsSidebarProps) {
  const searching = query.trim().length > 0;
  const side = useRef<HTMLElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const navMemory = useRef<DocsNavMemory>({ scrollTop: 0, shown: null });
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (navOpen === 'search') side.current?.querySelector<HTMLElement>('.docs-find input')?.focus();
    if (navOpen === 'contents') closeButton.current?.focus();
  }, [navOpen]);
  const openFirst = () => {
    const [first] = searchGuidePages(pages, query, 1);
    if (!first) return;
    onPicked();
    openDoc(first.slug, first.anchor);
  };
  return (
    <aside
      ref={side}
      id="docs-side"
      className="docs-side"
      aria-label="Guide contents"
      data-open={navOpen || undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && navOpen) onClose();
      }}
    >
      <a
        className="docs-skip"
        href={guideLink(current)}
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('docs-page-title')?.focus();
        }}
      >
        Skip to the page
      </a>
      <div className="docs-side-head">
        <p className="docs-side-title">User guide</p>
        <button
          ref={closeButton}
          type="button"
          className="docs-side-close"
          aria-label="Close contents"
          onClick={onClose}
        >
          <XIcon />
        </button>
      </div>
      <DocsSearchBox
        query={query}
        onQuery={onQuery}
        onSubmit={openFirst}
        onArrowDown={() => results.current?.querySelector<HTMLElement>('li a')?.focus()}
      />
      {searching ? (
        <SearchResults
          pages={pages}
          query={query}
          list={results}
          onPicked={onPicked}
          onLeaveTop={() => side.current?.querySelector<HTMLElement>('.docs-find input')?.focus()}
        />
      ) : (
        <DocsNav pages={pages} current={current} memoryRef={navMemory} onPicked={onPicked} />
      )}
    </aside>
  );
}

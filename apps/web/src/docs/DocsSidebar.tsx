import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  GUIDE_TYPE_LABELS,
  groupGuideSections,
  guideLink,
  searchGuidePages,
  type GuidePage,
} from '@spark-outpost/contracts';
import { ChevronIcon, SearchIcon, XIcon } from '../ui/icons.tsx';
import { openDoc } from './doc-route.ts';
import { recordMissedSearch } from './missed-searches.ts';

const MISSED_SEARCH_SETTLE_MS = 1_500;

interface DocsSidebarProps {
  pages: readonly GuidePage[];
  current: string;
  query: string;
  navOpen: boolean;
  onQuery: (query: string) => void;
  onToggleNav: () => void;
  onPicked: () => void;
}

function DocsSearchBox({
  query,
  onQuery,
  onSubmit,
}: {
  query: string;
  onQuery: (query: string) => void;
  onSubmit: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSubmit();
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
  onPicked,
}: {
  pages: readonly GuidePage[];
  query: string;
  onPicked: () => void;
}) {
  const hits = useMemo(() => searchGuidePages(pages, query), [pages, query]);
  const missed = hits.length === 0;
  useEffect(() => {
    if (!missed) return;
    const timer = window.setTimeout(() => recordMissedSearch(query), MISSED_SEARCH_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [missed, query]);
  return (
    <div className="docs-results">
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
        <ul aria-label="Search results">
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

function PageList({
  pages,
  current,
  onPicked,
}: {
  pages: readonly GuidePage[];
  current: string;
  onPicked: () => void;
}) {
  const sections = useMemo(() => groupGuideSections(pages), [pages]);
  const currentSection = pages.find((page) => page.slug === current)?.section;
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({});
  return (
    <nav id="docs-nav" className="docs-nav" aria-label="Guide pages">
      {sections.map((group) => {
        const id = `docs-sec-${group.pages[0]!.slug}`;
        const open = toggled[group.section] ?? group.section === currentSection;
        return (
          <section key={group.section} aria-labelledby={id}>
            <h2 id={id}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`${id}-pages`}
                onClick={() => setToggled((state) => ({ ...state, [group.section]: !open }))}
              >
                <ChevronIcon />
                {group.section}
                <span className="docs-nav-count">{group.pages.length}</span>
              </button>
            </h2>
            <ul id={`${id}-pages`} hidden={!open}>
              {group.pages.map((page) => (
                <li key={page.slug}>
                  <a
                    href={guideLink(page.slug)}
                    aria-current={page.slug === current ? 'page' : undefined}
                    onClick={onPicked}
                  >
                    {page.title}
                    {page.comingSoon && <span className="docs-soon">Soon</span>}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}

export function DocsSidebar({
  pages,
  current,
  query,
  navOpen,
  onQuery,
  onToggleNav,
  onPicked,
}: DocsSidebarProps) {
  const searching = query.trim().length > 0;
  const openFirst = () => {
    const [first] = searchGuidePages(pages, query, 1);
    if (!first) return;
    onPicked();
    openDoc(first.slug, first.anchor);
  };
  return (
    <aside className="docs-side" data-open={navOpen || undefined}>
      <div className="docs-side-head">
        <p className="docs-side-title">User guide</p>
        <button
          type="button"
          className="docs-nav-toggle"
          aria-expanded={navOpen}
          aria-controls={searching ? undefined : 'docs-nav'}
          onClick={onToggleNav}
        >
          Contents
        </button>
      </div>
      <DocsSearchBox query={query} onQuery={onQuery} onSubmit={openFirst} />
      {searching ? (
        <SearchResults pages={pages} query={query} onPicked={onPicked} />
      ) : (
        <PageList pages={pages} current={current} onPicked={onPicked} />
      )}
    </aside>
  );
}

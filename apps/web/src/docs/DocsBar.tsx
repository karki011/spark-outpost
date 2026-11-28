import type { RefObject } from 'react';
import { guideNavLabel, type GuidePage } from '@spark-outpost/contracts';
import { SearchIcon, SessionsIcon } from '../ui/icons.tsx';

export type DocsNavOpen = false | 'contents' | 'search';

interface DocsBarProps {
  page: GuidePage;
  navOpen: DocsNavOpen;
  contentsRef: RefObject<HTMLButtonElement | null>;
  onOpen: (open: DocsNavOpen) => void;
}

export function DocsBar({ page, navOpen, contentsRef, onOpen }: DocsBarProps) {
  return (
    <div className="docs-bar">
      <button
        ref={contentsRef}
        type="button"
        aria-label="Contents"
        aria-expanded={navOpen !== false}
        aria-controls="docs-side"
        onClick={() => onOpen('contents')}
      >
        <SessionsIcon />
      </button>
      <p className="docs-bar-where">
        <span>{page.section}</span>
        <b>{guideNavLabel(page)}</b>
      </p>
      <button type="button" aria-label="Search" onClick={() => onOpen('search')}>
        <SearchIcon />
      </button>
    </div>
  );
}

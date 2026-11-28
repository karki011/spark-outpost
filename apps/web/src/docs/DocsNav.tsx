import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import {
  groupGuideSections,
  guideLink,
  guideNavLabel,
  type GuidePage,
} from '@spark-outpost/contracts';
import { ChevronIcon } from '../ui/icons.tsx';
import { useOpenSections } from './open-sections.ts';

export interface DocsNavMemory {
  scrollTop: number;
  shown: string | null;
}

interface DocsNavProps {
  pages: readonly GuidePage[];
  current: string;
  memoryRef: RefObject<DocsNavMemory>;
  onPicked: () => void;
}

function useKeepCurrentInView(
  nav: RefObject<HTMLElement | null>,
  memoryRef: RefObject<DocsNavMemory>,
  current: string,
) {
  useEffect(() => {
    if (memoryRef.current.shown === current) return;
    memoryRef.current.shown = current;
    const list = nav.current;
    const row = list?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!list || !row) return;
    const frame = list.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    if (box.top < frame.top || box.bottom > frame.bottom) row.scrollIntoView({ block: 'nearest' });
    memoryRef.current.scrollTop = list.scrollTop;
  }, [nav, memoryRef, current]);
}

export function DocsNav({ pages, current, memoryRef, onPicked }: DocsNavProps) {
  const sections = useMemo(() => groupGuideSections(pages), [pages]);
  const currentSection = pages.find((page) => page.slug === current)?.section;
  const { isOpen, toggle } = useOpenSections(current, currentSection);
  const nav = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const list = nav.current;
    const memory = memoryRef.current;
    if (!list) return;
    list.scrollTop = memory.scrollTop;
    return () => {
      memory.scrollTop = list.scrollTop;
    };
  }, [memoryRef]);
  useKeepCurrentInView(nav, memoryRef, current);
  return (
    <nav
      id="docs-nav"
      ref={nav}
      className="docs-nav"
      aria-label="Guide pages"
      onScroll={(event) => {
        memoryRef.current.scrollTop = event.currentTarget.scrollTop;
      }}
    >
      {sections.map((group) => {
        const id = `docs-sec-${group.pages[0]!.slug}`;
        const open = isOpen(group.section);
        return (
          <section key={group.section} aria-labelledby={id}>
            <h2 id={id}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`${id}-pages`}
                onClick={() => toggle(group.section)}
              >
                <ChevronIcon />
                <span className="docs-nav-name">{group.section}</span>
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
                    <span className="docs-nav-name">{guideNavLabel(page)}</span>
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

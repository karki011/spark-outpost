import { useEffect, useState } from 'react';
import { guideLink, type GuideHeading } from '@spark-outpost/contracts';
import { ChevronIcon } from '../ui/icons.tsx';
import { DOC_HEADING_PREFIX } from './heading-ids.ts';

const READING_LINE = 96;

function headingInView(scroller: HTMLElement, headings: readonly GuideHeading[]): string | null {
  const line = Math.max(scroller.getBoundingClientRect().top, 0) + READING_LINE;
  const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
  if (atEnd && scroller.scrollTop > 0) return headings[headings.length - 1]?.anchor ?? null;
  let current: string | null = null;
  for (const heading of headings) {
    const element = document.getElementById(`${DOC_HEADING_PREFIX}${heading.anchor}`);
    if (element && element.getBoundingClientRect().top <= line) current = heading.anchor;
  }
  return current;
}

function useHeadingInView(slug: string, headings: readonly GuideHeading[]): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    const title = document.getElementById('docs-page-title');
    const scrollers = [
      title?.closest<HTMLElement>('.docs-main'),
      title?.closest<HTMLElement>('.page.docs'),
    ].filter((element): element is HTMLElement => Boolean(element));
    let frame = 0;
    const read = () => {
      const scroller = scrollers.find((entry) => entry.scrollHeight > entry.clientHeight);
      setCurrent(scroller ? headingInView(scroller, headings) : null);
    };
    const onScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(read);
    };
    onScroll();
    for (const scroller of scrollers)
      scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      for (const scroller of scrollers) scroller.removeEventListener('scroll', onScroll);
    };
  }, [slug, headings]);
  return current;
}

export function DocOutline({
  slug,
  headings,
}: {
  slug: string;
  headings: readonly GuideHeading[];
}) {
  const current = useHeadingInView(slug, headings);
  const [open, setOpen] = useState(false);
  return (
    <nav
      className="docs-outline"
      aria-labelledby="docs-outline-title"
      data-open={open || undefined}
    >
      <p id="docs-outline-title">On this page</p>
      <button
        type="button"
        className="docs-outline-toggle"
        aria-expanded={open}
        aria-controls="docs-outline-list"
        onClick={() => setOpen((shown) => !shown)}
      >
        <ChevronIcon />
        On this page
        <span className="docs-outline-count">{headings.length} sections</span>
      </button>
      <ul id="docs-outline-list">
        {headings.map((heading) => (
          <li key={heading.anchor}>
            <a
              href={guideLink(slug, heading.anchor)}
              aria-current={heading.anchor === current ? 'location' : undefined}
              onClick={() => setOpen(false)}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

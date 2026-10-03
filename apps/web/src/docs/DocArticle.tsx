import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import {
  GUIDE_TYPE_LABELS,
  guideBodyWithoutNext,
  guideHrefTarget,
  guideLink,
  type GuideHeading,
  type GuidePage,
} from '@spark-outpost/contracts';
import { codeComponents, remarkPlugins } from '../chat/markdown/Markdown.tsx';
import { remarkCallouts } from './callouts.ts';
import { guideImage } from './guide-content.ts';
import { DOC_HEADING_PREFIX, remarkHeadingIds } from './heading-ids.ts';
import { useColorScheme } from './use-color-scheme.ts';

const WEB_LINK = /^(https?:|mailto:)/i;
const OUTLINE_MIN_HEADINGS = 3;
const plugins = [...remarkPlugins, remarkHeadingIds, remarkCallouts];

interface DocArticleProps {
  page: GuidePage;
  anchor: string | null;
  previous: GuidePage | null;
  next: GuidePage | null;
}

function DocImage({ src, alt }: { src: string; alt: string }) {
  const scheme = useColorScheme();
  const url = guideImage(src, scheme);
  if (!url) return <span className="doc-shot-missing">Screenshot coming: {alt}</span>;
  return <img className="doc-shot" src={url} alt={alt} loading="lazy" />;
}

function DocAnchor({
  slug,
  href,
  children,
}: {
  slug: string;
  href: string | undefined;
  children?: ReactNode;
}) {
  if (!href) return <span>{children}</span>;
  const target = guideHrefTarget(href);
  if (target) return <a href={guideLink(target.slug || slug, target.anchor)}>{children}</a>;
  if (WEB_LINK.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return <span>{children}</span>;
}

function useScrollToTarget(page: GuidePage, anchor: string | null) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    const initial = first.current;
    first.current = false;
    const target = anchor ? document.getElementById(`${DOC_HEADING_PREFIX}${anchor}`) : null;
    if (target) {
      target.scrollIntoView({ block: 'start' });
      target.focus({ preventScroll: true });
      return;
    }
    titleRef.current?.closest('article')?.scrollIntoView({ block: 'start' });
    if (!initial) titleRef.current?.focus({ preventScroll: true });
  }, [page.slug, anchor]);
  return titleRef;
}

function PageLink({ page, rel }: { page: GuidePage; rel: 'prev' | 'next' }) {
  return (
    <a className={`docs-pager-${rel}`} href={guideLink(page.slug)} rel={rel}>
      <span>{rel === 'prev' ? 'Previous' : 'Next'}</span>
      {page.title}
    </a>
  );
}

function Outline({ slug, headings }: { slug: string; headings: readonly GuideHeading[] }) {
  return (
    <nav className="docs-outline" aria-labelledby="docs-outline-title">
      <p id="docs-outline-title">On this page</p>
      <ul>
        {headings.map((heading) => (
          <li key={heading.anchor}>
            <a href={guideLink(slug, heading.anchor)}>{heading.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export const DocArticle = memo(function DocArticle({
  page,
  anchor,
  previous,
  next,
}: DocArticleProps) {
  const titleRef = useScrollToTarget(page, anchor);
  const components = useMemo<Components>(
    () => ({
      ...codeComponents,
      a: ({ href, children }) => (
        <DocAnchor slug={page.slug} href={href}>
          {children}
        </DocAnchor>
      ),
      img: ({ src, alt }) =>
        typeof src === 'string' ? <DocImage src={src} alt={alt ?? ''} /> : null,
    }),
    [page.slug],
  );
  const body = useMemo(() => guideBodyWithoutNext(page), [page]);
  const outline = page.headings.filter((heading) => heading.depth === 2);
  const outlined = page.type !== 'start' && outline.length >= OUTLINE_MIN_HEADINGS;
  const typeLabel = GUIDE_TYPE_LABELS[page.type];

  return (
    <div className="docs-main">
      <article
        className="docs-article"
        aria-labelledby="docs-page-title"
        data-page={page.slug}
        data-type={page.type}
        data-outlined={outlined || undefined}
      >
        <header className="docs-head">
          <p className="docs-crumb">
            <span className="docs-type" data-type={page.type}>
              {typeLabel}
            </span>
            {page.section !== typeLabel && page.section}
          </p>
          <h1 id="docs-page-title" ref={titleRef} tabIndex={-1}>
            {page.title}
          </h1>
          <p className="docs-lede">{page.summary}</p>
        </header>
        {outlined && <Outline slug={page.slug} headings={outline} />}
        <div className="md docs-body">
          <ReactMarkdown remarkPlugins={plugins} components={components}>
            {body}
          </ReactMarkdown>
        </div>
        {(previous || next) && (
          <nav className="docs-pager" aria-label="More pages">
            {previous && <PageLink page={previous} rel="prev" />}
            {next && <PageLink page={next} rel="next" />}
          </nav>
        )}
      </article>
    </div>
  );
});

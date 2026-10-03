import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { guideHrefTarget, guideLink, type GuidePage } from '@spark-outpost/contracts';
import { codeComponents, remarkPlugins } from '../chat/markdown/Markdown.tsx';
import { guideImage } from './guide-content.ts';
import { DOC_HEADING_PREFIX, remarkHeadingIds } from './heading-ids.ts';
import { useColorScheme } from './use-color-scheme.ts';

const WEB_LINK = /^(https?:|mailto:)/i;
const plugins = [...remarkPlugins, remarkHeadingIds];

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
    titleRef.current?.parentElement?.scrollIntoView({ block: 'start' });
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

  return (
    <div className="docs-main">
      <article className="docs-article" aria-labelledby="docs-page-title">
        <p className="docs-crumb">{page.section}</p>
        <h1 id="docs-page-title" ref={titleRef} tabIndex={-1}>
          {page.title}
        </h1>
        <p className="docs-lede">{page.summary}</p>
        <div className="md docs-body">
          <ReactMarkdown remarkPlugins={plugins} components={components}>
            {page.body}
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

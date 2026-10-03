import './docs.css';
import './docs-article.css';
import { useEffect, useState } from 'react';
import { guideLink } from '@spark-outpost/contracts';
import { useDocRoute } from './doc-route.ts';
import { DocArticle } from './DocArticle.tsx';
import { DocsSidebar } from './DocsSidebar.tsx';
import { guidePages, openDocFor } from './guide-content.ts';

function useCanonicalLink(slug: string | undefined, anchor: string | null, routed: boolean) {
  useEffect(() => {
    if (!slug || !routed) return;
    const canonical = guideLink(slug, anchor);
    if (window.location.hash === canonical) return;
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, '', `${pathname}${search}${canonical}`);
  }, [slug, anchor, routed]);
}

export function DocsPage() {
  const route = useDocRoute();
  const [query, setQuery] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const open = openDocFor(route);
  useCanonicalLink(open?.page.slug, open?.anchor ?? null, Boolean(route?.slug));

  if (!open) {
    return (
      <main className="page docs" aria-label="Docs">
        <p className="docs-empty">The user guide isn't included in this build.</p>
      </main>
    );
  }

  return (
    <main className="page docs" aria-label="Docs">
      <DocsSidebar
        pages={guidePages}
        current={open.page.slug}
        query={query}
        navOpen={navOpen}
        onQuery={setQuery}
        onToggleNav={() => setNavOpen((shown) => !shown)}
        onPicked={() => {
          setQuery('');
          setNavOpen(false);
        }}
      />
      <DocArticle page={open.page} anchor={open.anchor} previous={open.previous} next={open.next} />
    </main>
  );
}

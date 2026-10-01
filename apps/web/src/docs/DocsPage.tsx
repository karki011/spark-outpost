import './docs.css';
import { useState } from 'react';
import { useDocRoute } from './doc-route.ts';
import { DocArticle } from './DocArticle.tsx';
import { DocsSidebar } from './DocsSidebar.tsx';
import { guidePages } from './guide-content.ts';

export function DocsPage() {
  const route = useDocRoute();
  const [query, setQuery] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const index = Math.max(
    0,
    guidePages.findIndex((page) => page.slug === route?.slug),
  );
  const page = guidePages[index];

  if (!page) {
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
        current={page.slug}
        query={query}
        navOpen={navOpen}
        onQuery={setQuery}
        onToggleNav={() => setNavOpen((open) => !open)}
        onPicked={() => {
          setQuery('');
          setNavOpen(false);
        }}
      />
      <DocArticle
        page={page}
        anchor={route?.slug === page.slug ? route.anchor : null}
        previous={guidePages[index - 1] ?? null}
        next={guidePages[index + 1] ?? null}
      />
    </main>
  );
}

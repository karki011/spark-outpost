import './docs.css';

export function DocsSkeleton() {
  return (
    <main className="page docs" aria-label="Docs" aria-busy="true">
      <aside className="docs-side">
        <span className="docs-sk docs-sk-find" />
        {Array.from({ length: 9 }, (_, row) => (
          <span key={row} className="docs-sk docs-sk-nav" />
        ))}
      </aside>
      <div className="docs-main">
        <div className="docs-article">
          <span className="docs-sk docs-sk-crumb" />
          <span className="docs-sk docs-sk-title" />
          {Array.from({ length: 6 }, (_, row) => (
            <span key={row} className="docs-sk docs-sk-line" />
          ))}
        </div>
      </div>
    </main>
  );
}

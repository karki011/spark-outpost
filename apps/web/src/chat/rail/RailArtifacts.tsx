import { useId, useState } from 'react';
import { ARTIFACT_KIND_LABELS, type ArtifactPage } from '@spark-outpost/contracts';
import { ArtifactIcon } from '../../ui/icons.tsx';

interface RailArtifactsProps {
  pages: readonly ArtifactPage[];
  onOpen(page: ArtifactPage): void;
}

function countLine(count: number): string {
  return count === 1 ? '1 artifact' : `${count} artifacts`;
}

export function RailArtifacts({ pages, onOpen }: RailArtifactsProps) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  return (
    <section className="crail-section" aria-label="Artifacts">
      <div className="crail-head">
        <button
          type="button"
          className="crail-fold"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          <span className="crail-title">Artifacts</span>
          {!open && <span className="crail-detail">{countLine(pages.length)}</span>}
          <span className="crail-chevron" data-open={open || undefined} aria-hidden="true">
            ›
          </span>
        </button>
      </div>
      <ul id={bodyId} className="crail-rows" hidden={!open}>
        {pages.map((page) => (
          <li key={page.id}>
            <button
              type="button"
              className="crail-row"
              aria-label={`Open artifact ${page.title}`}
              onClick={() => onOpen(page)}
            >
              <span className="crail-ico" aria-hidden="true">
                <ArtifactIcon />
              </span>
              <span className="crail-main">{page.title}</span>
              <span className="crail-detail">
                {ARTIFACT_KIND_LABELS[page.kind]} · version {page.versions.at(-1)?.version ?? 1}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

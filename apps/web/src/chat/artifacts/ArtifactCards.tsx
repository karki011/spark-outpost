import './artifacts.css';
import { ARTIFACT_KIND_LABELS, type ArtifactPage } from '@spark-outpost/contracts';
import { ArtifactIcon } from '../../ui/icons.tsx';
import { openArtifact } from './artifact-pane-store.ts';

interface ArtifactCardsProps {
  chatId: string;
  runId: string;
  pages: readonly ArtifactPage[] | undefined;
}

export function ArtifactCards({ chatId, runId, pages = [] }: ArtifactCardsProps) {
  const made = pages.flatMap((page) => {
    const version = page.versions.findLast((entry) => entry.runId === runId);
    return version ? [{ page, version }] : [];
  });
  if (made.length === 0) return null;
  return (
    <>
      {made.map(({ page, version }) => (
        <div key={page.id} className="art-card" role="group" aria-label={`Artifact ${page.title}`}>
          <span className="art-card-icon" aria-hidden="true">
            <ArtifactIcon />
          </span>
          <span className="art-card-text">
            <b>{version.title}</b>
            <small>
              Artifact · {ARTIFACT_KIND_LABELS[page.kind]} · version {version.version}
            </small>
          </span>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => openArtifact(chatId, page.id, version.version)}
          >
            Open
          </button>
        </div>
      ))}
    </>
  );
}

import type { ArtifactPage } from '@spark-outpost/contracts';
import type { PanelChrome } from '../../tasks/WorkPanel.tsx';
import type { ArtifactPaneChoice } from './artifact-pane-store.ts';
import { ArtifactPane } from './ArtifactPane.tsx';

function ArtifactClose({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="btn ghost sm" onClick={onClose}>
      Close artifact
    </button>
  );
}

export function artifactTab(page: ArtifactPage, choice: ArtifactPaneChoice) {
  return {
    title: page.title,
    render: ({ views, close }: PanelChrome) => (
      <ArtifactPane
        page={page}
        choice={choice}
        lead={views}
        trail={
          <>
            <ArtifactClose onClose={choice.close} />
            {close}
          </>
        }
      />
    ),
  };
}

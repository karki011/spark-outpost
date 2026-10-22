import './artifacts.css';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ARTIFACT_FILE_EXTENSIONS,
  ARTIFACT_FRAME_SANDBOX,
  artifactPath,
  artifactViewSchema,
  type ArtifactPage,
  type ArtifactView,
} from '@spark-outpost/contracts';
import { request } from '../../api/client.ts';
import { PHONE_SWITCH_OFF, useRemoteClient } from '../../phone/use-remote-client.ts';
import { copyButtonText, useCopyFeedback } from '../../ui/use-copy-feedback.ts';
import { ChoicePicker } from '../../ui/ChoicePicker.tsx';
import { ExportButton } from '../../ui/ExportButton.tsx';
import { CopyIcon } from '../../ui/icons.tsx';
import { Markdown } from '../markdown/Markdown.tsx';
import type { ArtifactPaneChoice } from './artifact-pane-store.ts';

interface ArtifactPaneProps {
  page: ArtifactPage;
  choice: ArtifactPaneChoice;
  lead: ReactNode;
  trail: ReactNode;
}

function SvgImage({ view }: { view: ArtifactView }) {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(view.text)}`;
  return <img className="art-svg" src={src} alt={view.title} />;
}

function HtmlFrame({ view }: { view: ArtifactView }) {
  const { remote } = useRemoteClient();
  const src = remote ? `/api${artifactPath(view.id, view.version, 'page')}` : view.viewUrl;
  if (!src) return <p className="art-note">This page can't be shown right now.</p>;
  return (
    <iframe
      key={src}
      className="art-frame"
      title={view.title}
      src={src}
      sandbox={ARTIFACT_FRAME_SANDBOX}
      referrerPolicy="no-referrer"
    />
  );
}

function ArtifactBody({ view }: { view: ArtifactView }) {
  if (view.kind === 'html') return <HtmlFrame view={view} />;
  if (view.kind === 'svg') return <SvgImage view={view} />;
  return (
    <div className="art-doc">
      <Markdown text={view.text} />
    </div>
  );
}

export function ArtifactPane({ page, choice, lead, trail }: ArtifactPaneProps) {
  const latest = page.versions.at(-1)?.version ?? 1;
  const version = choice.current.version ?? latest;
  const copied = useCopyFeedback();
  const { remote, allows } = useRemoteClient();
  const switchedOff = remote && !allows('artifacts');
  const view = useQuery({
    queryKey: ['artifact', page.id, version],
    queryFn: () => request(artifactViewSchema, artifactPath(page.id, version, 'view')),
    staleTime: Infinity,
    enabled: !switchedOff,
  });
  return (
    <section className="art" aria-label={`Artifact ${page.title}`}>
      <div className="art-head">
        {lead}
        <b className="art-title">{view.data?.title ?? page.title}</b>
        <div className="art-version">
          <ChoicePicker
            label="Version"
            choices={page.versions.map((entry) => ({
              id: String(entry.version),
              label: `v${entry.version}`,
            }))}
            value={String(version)}
            onChange={(id) => choice.pickVersion(Number(id))}
          />
        </div>
        <button
          type="button"
          className="btn ghost sm"
          disabled={!view.data}
          onClick={() => view.data && copied.copy(view.data.text)}
        >
          <CopyIcon />
          {copyButtonText(copied.state)}
        </button>
        {!remote && (
          <ExportButton
            url={`/api${artifactPath(page.id, version, 'file')}`}
            fileName={`${page.title}.${ARTIFACT_FILE_EXTENSIONS[page.kind]}`}
            label="Save as…"
          />
        )}
        {trail}
      </div>
      {page.kind === 'html' && (
        <p className="art-badge">Sandboxed · no network · no access to Spark</p>
      )}
      <div className="art-body">
        {switchedOff ? (
          <p className="art-note">{PHONE_SWITCH_OFF}</p>
        ) : view.data ? (
          <ArtifactBody view={view.data} />
        ) : (
          <p className="art-note" role="status">
            {view.isError ? 'This artifact could not be opened.' : 'Opening the artifact…'}
          </p>
        )}
      </div>
    </section>
  );
}

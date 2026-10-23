import { useEffect, useId, useState, type ReactNode } from 'react';
import { browserDownloadsSchema, type BrowserDownload } from '@spark-outpost/contracts';
import { desktopBrowserView } from '../desktop/desktop-bridge.ts';
import { CheckIcon, DownloadIcon, FolderIcon, SpinnerIcon, WarnIcon, XIcon } from '../ui/icons.tsx';
import { downloadStatus, type DownloadTone } from './downloads-model.ts';

function useDownloads(): readonly BrowserDownload[] {
  const [list, setList] = useState<readonly BrowserDownload[]>([]);
  useEffect(() => {
    const view = desktopBrowserView();
    if (!view) return;
    const accept = (raw: unknown) => {
      const parsed = browserDownloadsSchema.safeParse(raw);
      if (parsed.success) setList(parsed.data);
    };
    void view.downloads().then(accept);
    return view.onDownloads(accept);
  }, []);
  return list;
}

const TONE_ICONS: Record<DownloadTone, () => ReactNode> = {
  ok: () => <CheckIcon />,
  busy: () => <SpinnerIcon />,
  stopped: () => <XIcon />,
  refused: () => <WarnIcon />,
};

function act(id: string, action: 'show' | 'cancel') {
  void desktopBrowserView()?.downloadAct({ id, action });
}

function DownloadRow({ entry }: { entry: BrowserDownload }) {
  const status = downloadStatus(entry);
  return (
    <li className="bv-dl" data-tone={status.tone}>
      <span className="bv-dl-icon" aria-hidden="true">
        {TONE_ICONS[status.tone]()}
      </span>
      <span className="bv-dl-main">
        <span className="bv-dl-name">{entry.filename || 'Download'}</span>
        <span className="bv-dl-status" title={status.text}>
          {status.text}
        </span>
      </span>
      {entry.state === 'saving' && (
        <button
          type="button"
          className="icon-btn bv-dl-act"
          aria-label={`Cancel ${entry.filename}`}
          onClick={() => act(entry.id, 'cancel')}
        >
          <XIcon />
        </button>
      )}
      {entry.state === 'saved' && (
        <button
          type="button"
          className="icon-btn bv-dl-act"
          aria-label={`Show ${entry.filename} in Finder`}
          onClick={() => act(entry.id, 'show')}
        >
          <FolderIcon />
        </button>
      )}
    </li>
  );
}

export function ViewDownloads() {
  const ids = useId();
  const list = useDownloads();
  const [open, setOpen] = useState(false);
  const latest = list[0];
  return (
    <section className="bv-dls" aria-label="Downloads">
      {open && (
        <ul className="bv-dl-list" id={`${ids}-list`}>
          {list.length === 0 && <li className="bv-dl-empty">Nothing downloaded yet.</li>}
          {list.map((entry) => (
            <DownloadRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      <button
        type="button"
        className="btn bv-dl-toggle"
        aria-expanded={open}
        aria-controls={`${ids}-list`}
        onClick={() => setOpen(!open)}
      >
        <DownloadIcon />
        Downloads
        {list.length > 0 && <span className="bv-dl-count">{list.length}</span>}
      </button>
      <p className="sr-only" role="status">
        {latest ? `${latest.filename}: ${downloadStatus(latest).text}` : ''}
      </p>
    </section>
  );
}

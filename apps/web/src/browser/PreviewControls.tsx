import { useEffect, useRef } from 'react';
import { previewLive, type BrowserPaneTab, type ChatPreview } from '@spark-outpost/contracts';
import { showPreviewShell } from '../terminal/dock/shell-store.ts';
import { SpinnerIcon } from '../ui/icons.tsx';
import { sendBrowserCommand } from './browser-store.ts';
import { useChatPreview } from './use-chat-preview.ts';

interface PreviewProps {
  chatId: string;
  tab: BrowserPaneTab | null;
}

function openPreview(chatId: string, tab: BrowserPaneTab | null, url: string): void {
  if (tab) sendBrowserCommand(chatId, { command: 'navigate', tabId: tab.id, url });
  else sendBrowserCommand(chatId, { command: 'new_tab', url });
}

function failure(preview: ChatPreview): string | null {
  return preview.server?.status === 'failed'
    ? (preview.server.detail ?? 'It did not start.')
    : null;
}

export function PreviewStart({ chatId, tab }: PreviewProps) {
  const { preview, start, error } = useChatPreview(chatId);
  const wanted = useRef(false);
  const server = preview?.server ?? null;
  const readyUrl = server?.status === 'ready' ? server.url : null;

  useEffect(() => {
    if (!wanted.current || !readyUrl) return;
    wanted.current = false;
    openPreview(chatId, tab, readyUrl);
  }, [chatId, tab, readyUrl]);

  if (!preview?.preview) return null;
  const starting = start.isPending || server?.status === 'starting';
  const failed = failure(preview);
  return (
    <div className="bp-preview" role="group" aria-label="Preview">
      <p>
        Spark can run <code>{preview.preview.command}</code> for {preview.projectName} and open{' '}
        {preview.preview.url}.
      </p>
      {readyUrl ? (
        <button
          type="button"
          className="btn primary sm"
          onClick={() => openPreview(chatId, tab, readyUrl)}
        >
          Open preview
        </button>
      ) : (
        <button
          type="button"
          className="btn primary sm"
          disabled={starting}
          onClick={() => {
            wanted.current = true;
            start.mutate();
          }}
        >
          {starting ? 'Starting preview' : 'Start preview'}
        </button>
      )}
      {starting && (
        <span className="bp-preview-wait" role="status">
          <SpinnerIcon /> Waiting for {preview.preview.readyUrl ?? preview.preview.url} to answer
        </span>
      )}
      {(failed ?? error) && (
        <pre className="bp-preview-fail" role="alert">
          {failed ?? error}
        </pre>
      )}
    </div>
  );
}

export function PreviewBadge({ chatId }: { chatId: string }) {
  const { preview, stop } = useChatPreview(chatId);
  const server = preview?.server ?? null;
  if (!server || !previewLive(server)) return null;
  const word = server.status === 'ready' ? 'Preview running' : 'Preview starting';
  return (
    <span className="bp-preview-live" role="group" aria-label="Preview server">
      <span className="bp-badge" title={server.url ?? undefined}>
        {word}
      </span>
      <button type="button" className="bp-link" onClick={() => showPreviewShell(chatId)}>
        Show output
      </button>
      <button
        type="button"
        className="bp-link"
        disabled={stop.isPending}
        onClick={() => stop.mutate()}
      >
        Stop preview
      </button>
    </span>
  );
}

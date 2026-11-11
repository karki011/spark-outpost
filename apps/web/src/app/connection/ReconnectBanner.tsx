import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { wakeHelp } from './connection-copy.ts';
import { markConnectionRestored } from './connection-store.ts';
import { rememberedRemoteClient } from './remote-hint.ts';
import { PanicScout } from './PanicScout.tsx';
import { usePanelAnchor } from './use-panel-anchor.ts';
import { reconnectLabel, useAutoRetry } from './use-auto-retry.ts';
import './connection.css';

function remoteNote(failedAttempts: number): string {
  return (
    wakeHelp('unreachable', true, failedAttempts) ||
    "Can't reach your Mac. It may be asleep or off Tailscale."
  );
}

export function ReconnectBanner() {
  const remote = rememberedRemoteClient();
  const queryClient = useQueryClient();
  const anchor = usePanelAnchor();
  const retry = useAutoRetry(async () => {
    await api.health();
    markConnectionRestored();
    void queryClient.invalidateQueries();
  });

  return (
    <div className={remote ? 'reconnect remote' : 'reconnect'} style={anchor}>
      <span className="sr-only" role="status">
        {remote
          ? "Can't reach your Mac. Reconnecting."
          : 'Lost the connection to the server. Reconnecting.'}
      </span>
      <PanicScout fixing={retry.retrying} />
      <b>{reconnectLabel(retry)}</b>
      <small>{remote ? remoteNote(retry.failedAttempts) : 'Your chat stays open.'}</small>
      <button
        type="button"
        className="btn line sm"
        onClick={retry.retryNow}
        disabled={retry.retrying}
      >
        Try now
      </button>
    </div>
  );
}

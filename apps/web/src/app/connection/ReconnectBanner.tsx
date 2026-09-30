import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { markConnectionRestored } from './connection-store.ts';
import { PanicScout } from './PanicScout.tsx';
import { usePanelAnchor } from './use-panel-anchor.ts';
import { reconnectLabel, useAutoRetry } from './use-auto-retry.ts';
import './connection.css';

export function ReconnectBanner() {
  const queryClient = useQueryClient();
  const anchor = usePanelAnchor();
  const retry = useAutoRetry(async () => {
    await api.health();
    markConnectionRestored();
    void queryClient.invalidateQueries();
  });

  return (
    <div className="reconnect" style={anchor}>
      <span className="sr-only" role="status">
        Lost the connection to the server. Reconnecting.
      </span>
      <PanicScout fixing={retry.retrying} />
      <b>{reconnectLabel(retry)}</b>
      <small>Your chat stays open.</small>
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

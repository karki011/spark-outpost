import { isConnectionLoss } from '../app/connection/connection-failure.ts';
import { LoadingBlob } from '../ui/loading/LoadingBlob.tsx';

interface ChatLoadingProps {
  fetching: boolean;
  failed: boolean;
  onRetry: () => void;
}

export function ChatLoading({ fetching, failed, onRetry }: ChatLoadingProps) {
  return (
    <div className="thread-wrap" aria-busy={fetching}>
      {fetching ? (
        <LoadingBlob size="lg" className="thread-loading" line="Opening this chat…" />
      ) : failed ? (
        <div className="thread-loading" role="alert">
          <p>Couldn’t open this chat. Your draft is kept.</p>
          <button className="btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ChatRefreshError({ error }: { error: Error | null }) {
  if (!error || isConnectionLoss(error)) return null;
  return (
    <p className="error-line" role="alert">
      {error.message}
    </p>
  );
}

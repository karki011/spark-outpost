import './loading.css';
import { BlobScout } from '../../brand/BlobScout.tsx';

interface LoadRetryProps {
  what: string;
  error?: string | null;
  retrying?: boolean;
  onRetry(): void;
}

export function LoadRetry({ what, error = null, retrying = false, onRetry }: LoadRetryProps) {
  const failed = error !== null;
  return (
    <div className={failed ? 'loadretry bad' : 'loadretry'} role={failed ? 'alert' : 'status'}>
      <BlobScout size={28} mood={failed ? 'sad' : 'working'} />
      <span className="loadretry-text">
        <b>{failed ? `Couldn’t load ${what}.` : `${capitalize(what)} is taking a while.`}</b>
        <small>{failed ? error : 'Still trying. You can start it again.'}</small>
      </span>
      <button type="button" className="btn line sm" disabled={retrying} onClick={onRetry}>
        {retrying ? 'Trying again…' : 'Try again'}
      </button>
    </div>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

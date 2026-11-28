import { copyButtonText, useCopyFeedback } from '../ui/use-copy-feedback.ts';
import type { ShareKeys } from './share-keys.ts';

function KeyRow({ name, value }: { name: string; value: string }) {
  const { state, copy } = useCopyFeedback();
  return (
    <div>
      <dt>{name}</dt>
      <dd>
        <span aria-hidden="true">••••••••••••</span>
        <button
          type="button"
          className="btn line sm"
          aria-label={`${copyButtonText(state)} ${name}`}
          onClick={() => copy(value)}
        >
          {copyButtonText(state)}
        </button>
        {state !== 'idle' && (
          <span className="sr-only" role="status">
            {name}: {copyButtonText(state)}
          </span>
        )}
      </dd>
    </div>
  );
}

export function CloudflareKeys({ keys }: { keys: ShareKeys }) {
  return (
    <div className="cf-keys">
      <p>
        Cloudflare asks for two keys. Spark made them for you; copy each into the box with its name.
      </p>
      <dl className="cf-facts">
        <KeyRow name="UPLOAD_KEY" value={keys.uploadKey} />
        <KeyRow name="SIGNING_KEY" value={keys.signingKey} />
      </dl>
    </div>
  );
}

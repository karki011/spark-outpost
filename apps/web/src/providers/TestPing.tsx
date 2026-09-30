import type { ConnectableId } from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import './test-ping.css';

export function TestPing({ providerId }: { providerId: ConnectableId }) {
  return (
    <span className="test-ping" aria-hidden="true">
      <span className="tp-send">
        <BlobScout size={22} mood="working" />
      </span>
      <span className="tp-wire">
        <i className="tp-note" />
      </span>
      <span className="tp-reply">
        <ProviderBlob providerId={providerId} size={22} animate="always" />
      </span>
    </span>
  );
}

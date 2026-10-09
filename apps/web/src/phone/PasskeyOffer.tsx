import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { setupApi, setupKey } from '../api/setup.ts';
import { usePanelAnchor } from '../app/connection/use-panel-anchor.ts';
import { XIcon } from '../ui/icons.tsx';
import { dismissPasskeyOffer, passkeyOfferDismissed } from './passkey-offer-store.ts';
import { passkeysSupported } from './passkey-browser.ts';
import { phoneApi, phoneKeys } from './phone-api.ts';
import { PASSKEY_PURPOSE, PASSKEY_SAVE, PASSKEY_SAVED } from './phone-copy.ts';
import { useRemoteClient } from './use-remote-client.ts';
import { useSavePasskey } from './use-save-passkey.ts';
import './passkey-offer.css';

function Offer({ onDismiss }: { onDismiss: () => void }) {
  const passkeys = useQuery({ queryKey: phoneKeys.passkeys, queryFn: phoneApi.passkeys });
  const save = useSavePasskey();
  const anchor = usePanelAnchor();
  if (!save.isSuccess && passkeys.data?.length !== 0) return null;
  return (
    <aside className="passkey-offer" aria-label="Passkey for this device" style={anchor}>
      {save.isSuccess ? (
        <p role="status">{PASSKEY_SAVED}</p>
      ) : (
        <p>
          <button
            type="button"
            className="passkey-offer-save"
            disabled={save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: dismissPasskeyOffer })}
          >
            {PASSKEY_SAVE}
          </button>
          . {PASSKEY_PURPOSE}
          {save.error && (
            <span className="passkey-offer-problem" role="alert">
              {' '}
              {save.error.message}
            </span>
          )}
        </p>
      )}
      <button
        type="button"
        className="passkey-offer-close"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <XIcon />
      </button>
    </aside>
  );
}

export function PasskeyOffer() {
  const [dismissed, setDismissed] = useState(passkeyOfferDismissed);
  const phone = useRemoteClient();
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get, retry: false });
  const otherNoticeShowing = setup.data?.profile.defaultLevelNotice === true;
  if (dismissed || otherNoticeShowing || !phone.remote) return null;
  if (!phone.allows('passkeys') || !passkeysSupported()) return null;
  return (
    <Offer
      onDismiss={() => {
        dismissPasskeyOffer();
        setDismissed(true);
      }}
    />
  );
}

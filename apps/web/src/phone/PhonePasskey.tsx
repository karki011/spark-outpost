import { useQuery } from '@tanstack/react-query';
import type { RemoteSession } from '@spark-outpost/contracts';
import { KeyIcon } from '../ui/icons.tsx';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { passkeysSupported } from './passkey-browser.ts';
import { phoneApi, phoneKeys } from './phone-api.ts';
import {
  PASSKEY_OFF,
  PASSKEY_PURPOSE,
  PASSKEY_SAVE,
  PASSKEY_SAVED,
  PASSKEY_UNSUPPORTED,
  passkeyName,
} from './phone-copy.ts';
import { useSavePasskey } from './use-save-passkey.ts';

function SavedPasskeys() {
  const passkeys = useQuery({ queryKey: phoneKeys.passkeys, queryFn: phoneApi.passkeys });
  const save = useSavePasskey();
  const supported = passkeysSupported();
  return (
    <>
      <QueryWait query={passkeys} what="passkeys">
        <Skeleton label="Loading passkeys" shape="list" rows={1} />
      </QueryWait>
      {passkeys.data && passkeys.data.length > 0 && (
        <ul className="ph-devices" aria-label="Saved passkeys">
          {passkeys.data.map((passkey) => (
            <li key={passkey.id} className="ph-device">
              <div className="ph-device-text">
                <b>{passkeyName(passkey)}</b>
                <span>
                  Saved {relativeTime(passkey.createdAt)}
                  {passkey.lastUsedAt && ` · Last used ${relativeTime(passkey.lastUsedAt)}`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <button
          type="button"
          className="btn line sm ph-passkey-save"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          <KeyIcon />
          {passkeys.data && passkeys.data.length > 0 ? 'Save another passkey' : PASSKEY_SAVE}
        </button>
      ) : (
        <p className="ph-note">{PASSKEY_UNSUPPORTED}</p>
      )}
      <p className="ph-note" role="status">
        {save.isSuccess ? PASSKEY_SAVED : ''}
      </p>
      {save.error && (
        <p className="ph-error" role="alert">
          {save.error.message}
        </p>
      )}
    </>
  );
}

export function PhonePasskey({ session }: { session: RemoteSession }) {
  return (
    <section className="ph-card" aria-labelledby="ph-passkey-title">
      <h2 id="ph-passkey-title">Passkey</h2>
      <p className="ph-note">{PASSKEY_PURPOSE} To remove a passkey, open Phone on your Mac.</p>
      {session.switches.passkeys ? <SavedPasskeys /> : <p className="ph-note">{PASSKEY_OFF}</p>}
    </section>
  );
}

import { useId } from 'react';
import type { RemoteSession } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import {
  NOTIFY_BLOCKED,
  NOTIFY_HOME_SCREEN,
  NOTIFY_LABEL,
  NOTIFY_OFF,
  NOTIFY_ON,
  NOTIFY_PURPOSE,
  NOTIFY_UNSUPPORTED,
} from './phone-copy.ts';
import { notificationsBlocked, pushSupport } from './push-browser.ts';
import { useDevicePush } from './use-device-push.ts';

function NotifyToggle({ allowed }: { allowed: boolean }) {
  const switchId = useId();
  const push = useDevicePush(true);
  const blocked = notificationsBlocked();
  const checked = push.change.isPending ? push.change.variables : push.on;
  const canTurnOn = allowed && !blocked;
  const error = push.change.error ?? push.loadError;
  return (
    <>
      <ul className="ph-switches">
        <li className="ph-switch">
          <label htmlFor={switchId}>{NOTIFY_LABEL}</label>
          <BlobToggle
            id={switchId}
            size="sm"
            label={NOTIFY_LABEL}
            checked={checked}
            disabled={!push.ready || (!push.on && !canTurnOn)}
            onChange={(next) => {
              if (!push.change.isPending) push.change.mutate(next);
            }}
          />
        </li>
      </ul>
      {!allowed && <p className="ph-note">{NOTIFY_OFF}</p>}
      {allowed && blocked && !push.on && <p className="ph-note">{NOTIFY_BLOCKED}</p>}
      <p className="ph-note" role="status">
        {push.on && allowed ? NOTIFY_ON : ''}
      </p>
      {error && (
        <p className="ph-error" role="alert">
          {error.message}
        </p>
      )}
    </>
  );
}

export function PhoneNotifications({ session }: { session: RemoteSession }) {
  const support = pushSupport();
  return (
    <section className="ph-card" aria-labelledby="ph-notify-title">
      <h2 id="ph-notify-title">Notifications</h2>
      <p className="ph-note">{NOTIFY_PURPOSE}</p>
      {support === 'supported' ? (
        <NotifyToggle allowed={session.switches.notifications} />
      ) : (
        <p className="ph-note">
          {support === 'needs_home_screen' ? NOTIFY_HOME_SCREEN : NOTIFY_UNSUPPORTED}
        </p>
      )}
    </section>
  );
}

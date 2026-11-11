import type { RemoteSession } from '@spark-outpost/contracts';
import { PhoneNotifications } from './PhoneNotifications.tsx';
import { PhonePasskey } from './PhonePasskey.tsx';
import { PhoneSwitchesReadOnly } from './PhoneSwitches.tsx';

export function RemotePhonePage({ session }: { session: RemoteSession }) {
  return (
    <>
      <section className="ph-card" aria-labelledby="ph-status-title">
        <h2 id="ph-status-title" data-status="on">
          <i className="ph-dot" aria-hidden="true" />
          Connected to your Mac
        </h2>
        {session.address && (
          <div className="ph-address">
            <span className="ph-address-label">Address</span>
            <code>{session.address}</code>
          </div>
        )}
      </section>
      <section className="ph-card" aria-labelledby="ph-device-title">
        <h2 id="ph-device-title">This device</h2>
        <p className="ph-note">
          {session.device ? <b>{session.device.name}</b> : 'This device'} is paired. To rename or
          remove it, or change what it can do, open Remote control on your Mac.
        </p>
      </section>
      <PhoneNotifications session={session} />
      <PhonePasskey session={session} />
      <PhoneSwitchesReadOnly switches={session.switches} />
    </>
  );
}

import { useState, type ReactNode } from 'react';
import type { RemoteDevice } from '@spark-outpost/contracts';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { DeviceRow } from './DeviceRow.tsx';
import { shortDate } from './phone-copy.ts';
import { PhoneSection } from './PhoneSection.tsx';
import { SwitchRow } from './PhoneSwitches.tsx';
import { hostWords } from '../desktop/host-words.ts';

const FRESH_SLACK_MS = 5000;

function RemovedDevices({ removed }: { removed: RemoteDevice[] }) {
  const [open, setOpen] = useState(false);
  if (removed.length === 0) return null;
  return (
    <div className="ph-removed">
      <button
        type="button"
        className="btn ghost sm"
        aria-expanded={open}
        aria-controls="ph-removed-list"
        onClick={() => setOpen(!open)}
      >
        {removed.length} removed {removed.length === 1 ? 'device' : 'devices'}
      </button>
      {open && (
        <ul id="ph-removed-list" className="ph-devices" aria-label="Removed devices">
          {removed.map((device) => (
            <li key={device.id} className="ph-device ph-device-removed">
              <div className="ph-device-text">
                <b>{device.name}</b>
                <span>
                  {device.replacedBy ? 'Replaced when it paired again' : 'Removed'}
                  {device.revokedAt && ` ${shortDate(device.revokedAt)}`} · Cannot connect
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface PhoneDevicesProps {
  devices: RemoteDevice[] | undefined;
  freshAfter: number | null;
  passkeysAllowed: boolean;
  pair: ReactNode;
  wait: ReactNode;
}

export const PASSKEY_SWITCH = 'Allow passkey sign-in';

function PasskeySwitch({ allowed }: { allowed: boolean }) {
  return (
    <div className="ph-passkey-switch">
      <ul className="ph-switches">
        <SwitchRow id="passkeys" checked={allowed} label={PASSKEY_SWITCH} />
      </ul>
      <p className="ph-note">
        A paired device can save a passkey and use it to sign in again in another browser, without
        coming back to this {hostWords().computer}. A passkey never pairs a new device. If this{' '}
        {hostWords().computer}&apos;s Tailscale name changes, saved passkeys stop matching and each
        device pairs again.
      </p>
    </div>
  );
}

export function PhoneDevices({
  devices,
  freshAfter,
  passkeysAllowed,
  pair,
  wait,
}: PhoneDevicesProps) {
  const active = (devices ?? []).filter((device) => !device.revokedAt);
  const removed = (devices ?? []).filter((device) => device.revokedAt).reverse();
  const now = useMinuteClock();
  const isFresh = (device: RemoteDevice) =>
    freshAfter !== null && new Date(device.createdAt).getTime() >= freshAfter - FRESH_SLACK_MS;

  return (
    <PhoneSection
      id="devices"
      title="Devices"
      count={active.length}
      className="ph-devices-card"
      lead={pair}
    >
      {devices === undefined && wait}
      {devices !== undefined && active.length === 0 && (
        <p className="ph-empty">No device is paired yet.</p>
      )}
      {active.length > 0 && (
        <ul className="ph-devices">
          {active.map((device) => (
            <DeviceRow key={device.id} device={device} fresh={isFresh(device)} now={now} />
          ))}
        </ul>
      )}
      <RemovedDevices removed={removed} />
      <PasskeySwitch allowed={passkeysAllowed} />
    </PhoneSection>
  );
}

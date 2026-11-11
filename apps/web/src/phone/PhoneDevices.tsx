import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RemoteDevice } from '@spark-outpost/contracts';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { DeviceRow } from './DeviceRow.tsx';
import { phoneApi, phoneKeys } from './phone-api.ts';
import { shortDate } from './phone-copy.ts';
import { SwitchRow } from './PhoneSwitches.tsx';

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
        {removed.length} removed
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
        coming back to this Mac. A passkey never pairs a new device. If this Mac&apos;s Tailscale
        name changes, saved passkeys stop matching and each device pairs again.
      </p>
    </div>
  );
}

export function PhoneDevices({ devices, freshAfter, passkeysAllowed, wait }: PhoneDevicesProps) {
  const queryClient = useQueryClient();
  const active = (devices ?? []).filter((device) => !device.revokedAt);
  const removed = (devices ?? []).filter((device) => device.revokedAt).reverse();
  const disconnect = useMutation({
    mutationFn: phoneApi.disconnectAll,
    onSuccess: (next) => {
      queryClient.setQueryData(phoneKeys.devices, next);
      void queryClient.invalidateQueries({ queryKey: phoneKeys.audit });
    },
  });
  const now = useMinuteClock();
  const isFresh = (device: RemoteDevice) =>
    freshAfter !== null && new Date(device.createdAt).getTime() >= freshAfter - FRESH_SLACK_MS;

  return (
    <section className="ph-card ph-devices-card" aria-labelledby="ph-devices-title">
      <div className="ph-card-head">
        <h2 id="ph-devices-title">Devices</h2>
        {active.length > 0 && <span className="ph-count">{active.length}</span>}
      </div>
      {devices === undefined && wait}
      {devices !== undefined && active.length === 0 && (
        <p className="ph-empty">No device is paired yet.</p>
      )}
      {active.length > 0 && (
        <>
          <ul className="ph-devices">
            {active.map((device) => (
              <DeviceRow key={device.id} device={device} fresh={isFresh(device)} now={now} />
            ))}
          </ul>
          <HoldToConfirm
            label="Hold to disconnect all"
            hint="Every device will need to pair again. Their passkeys are removed too."
            holdingHint="Keep holding. Let go now to cancel."
            releasedHint="Released early. Nothing happened."
            disabled={disconnect.isPending}
            onConfirm={() => disconnect.mutate()}
          />
          {disconnect.error && (
            <p className="ph-error" role="alert">
              {disconnect.error.message}
            </p>
          )}
        </>
      )}
      <RemovedDevices removed={removed} />
      <PasskeySwitch allowed={passkeysAllowed} />
    </section>
  );
}

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { REMOTE_DEVICE_NAME_MAX, type RemoteDevice } from '@spark-outpost/contracts';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { phoneApi, phoneKeys } from './phone-api.ts';

const FRESH_SLACK_MS = 5000;

function addedOn(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function RenameForm({ device, onDone }: { device: RemoteDevice; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(device.name);
  const rename = useMutation({
    mutationFn: () => phoneApi.rename(device.id, name.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: phoneKeys.all });
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) rename.mutate();
  };
  return (
    <form className="ph-rename" onSubmit={submit}>
      <input
        className="inp"
        aria-label={`New name for ${device.name}`}
        value={name}
        maxLength={REMOTE_DEVICE_NAME_MAX}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone();
        }}
      />
      <button type="submit" className="btn primary sm" disabled={rename.isPending || !name.trim()}>
        Save
      </button>
      <button type="button" className="btn ghost sm" onClick={onDone}>
        Cancel
      </button>
      {rename.error && (
        <p className="ph-error" role="alert">
          {rename.error.message}
        </p>
      )}
    </form>
  );
}

function DeviceRow({ device, fresh }: { device: RemoteDevice; fresh: boolean }) {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const revoke = useMutation({
    mutationFn: () => phoneApi.revoke(device.id),
    onSuccess: (devices) => {
      queryClient.setQueryData(phoneKeys.devices, devices);
      void queryClient.invalidateQueries({ queryKey: phoneKeys.audit });
    },
  });
  return (
    <li className={fresh ? 'ph-device fresh' : 'ph-device'}>
      {renaming ? (
        <RenameForm device={device} onDone={() => setRenaming(false)} />
      ) : (
        <>
          <div className="ph-device-text">
            <b>{device.name}</b>
            <span>
              Added {addedOn(device.createdAt)} · Last seen {relativeTime(device.lastSeenAt)}
              {device.expired && ' · Needs to pair again'}
            </span>
          </div>
          {device.connected && (
            <span className="ph-connected">
              <i className="ph-dot" aria-hidden="true" />
              Connected
            </span>
          )}
          <div className="ph-device-actions">
            <button
              type="button"
              className="btn ghost sm"
              aria-label={`Rename ${device.name}`}
              onClick={() => setRenaming(true)}
            >
              Rename
            </button>
            <button
              type="button"
              className="btn line sm danger"
              aria-label={`Revoke ${device.name}`}
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              Revoke
            </button>
          </div>
          {revoke.error && (
            <p className="ph-error" role="alert">
              {revoke.error.message}
            </p>
          )}
        </>
      )}
    </li>
  );
}

interface PhoneDevicesProps {
  devices: RemoteDevice[] | undefined;
  freshAfter: number | null;
  wait: ReactNode;
}

export function PhoneDevices({ devices, freshAfter, wait }: PhoneDevicesProps) {
  const queryClient = useQueryClient();
  const active = (devices ?? []).filter((device) => !device.revokedAt);
  const disconnect = useMutation({
    mutationFn: phoneApi.disconnectAll,
    onSuccess: (next) => {
      queryClient.setQueryData(phoneKeys.devices, next);
      void queryClient.invalidateQueries({ queryKey: phoneKeys.audit });
    },
  });
  const isFresh = (device: RemoteDevice) =>
    freshAfter !== null && new Date(device.createdAt).getTime() >= freshAfter - FRESH_SLACK_MS;

  return (
    <section className="ph-card" aria-labelledby="ph-devices-title">
      <h2 id="ph-devices-title">Devices</h2>
      {devices === undefined && wait}
      {devices !== undefined && active.length === 0 && (
        <p className="ph-empty">No phone is paired yet.</p>
      )}
      {active.length > 0 && (
        <>
          <ul className="ph-devices">
            {active.map((device) => (
              <DeviceRow key={device.id} device={device} fresh={isFresh(device)} />
            ))}
          </ul>
          <HoldToConfirm
            label="Hold to disconnect all"
            hint="Every device will need to pair again."
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
    </section>
  );
}

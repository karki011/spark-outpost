import '../conversations/chat-menu.css';
import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { REMOTE_DEVICE_NAME_MAX, type RemoteDevice } from '@spark-outpost/contracts';
import { MenuItem, MenuShell, type MenuAnchor } from '../conversations/MenuShell.tsx';
import { CheckIcon, DotsIcon, LaptopIcon, WarnIcon } from '../ui/icons.tsx';
import { daysUntilUnused, deviceSummary, lastSeenLine, stopsWorkingLine } from './device-copy.ts';
import { phoneApi, phoneKeys } from './phone-api.ts';

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

function DeviceState({ device, now }: { device: RemoteDevice; now: number }) {
  const days = daysUntilUnused(device, now);
  return (
    <>
      {device.connected ? (
        <span className="ph-connected">
          <CheckIcon />
          Connected now
        </span>
      ) : (
        <span className="ph-seen">{lastSeenLine(device, now)}</span>
      )}
      {device.expired && (
        <span className="ph-warn">
          <WarnIcon />
          Needs to pair again
        </span>
      )}
      {days !== null && (
        <span className="ph-warn">
          <WarnIcon />
          {stopsWorkingLine(days)}
        </span>
      )}
    </>
  );
}

interface DeviceRowProps {
  device: RemoteDevice;
  fresh: boolean;
  now: number;
}

export function DeviceRow({ device, fresh, now }: DeviceRowProps) {
  const queryClient = useQueryClient();
  const button = useRef<HTMLButtonElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const afterChange = (devices: RemoteDevice[]) => {
    queryClient.setQueryData(phoneKeys.devices, devices);
    void queryClient.invalidateQueries({ queryKey: phoneKeys.audit });
  };
  const revoke = useMutation({
    mutationFn: () => phoneApi.revoke(device.id),
    onSuccess: afterChange,
  });
  const removePasskeys = useMutation({
    mutationFn: () => phoneApi.removePasskeys(device.id),
    onSuccess: afterChange,
  });

  const close = () => {
    setAnchor(null);
    button.current?.focus();
  };
  const open = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({
      x: rect.right - 212,
      y: rect.bottom + 4,
      above: rect.top - 4,
      focusBack: button.current,
    });
  };
  const choose = (action: () => void, focusBack: boolean) => () => {
    setAnchor(null);
    if (focusBack) button.current?.focus();
    action();
  };
  const finishRename = () => {
    setRenaming(false);
    button.current?.focus();
  };
  const errors = [revoke.error, removePasskeys.error].flatMap((error) => error ?? []);

  return (
    <li className={fresh ? 'ph-device fresh' : 'ph-device'}>
      <span className="ph-device-icon" aria-hidden="true">
        <LaptopIcon />
      </span>
      <div className="ph-device-body">
        {renaming ? (
          <RenameForm device={device} onDone={finishRename} />
        ) : (
          <>
            <div className="ph-device-line">
              <b>{device.name}</b>
              <DeviceState device={device} now={now} />
            </div>
            <span className="ph-device-summary">{deviceSummary(device)}</span>
          </>
        )}
      </div>
      <button
        ref={button}
        type="button"
        className="icon-btn ph-device-menu"
        aria-label={`Actions for ${device.name}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        disabled={revoke.isPending || removePasskeys.isPending}
        onClick={() => (anchor ? close() : open())}
      >
        <DotsIcon />
      </button>
      {anchor && (
        <MenuShell anchor={anchor} label={`Actions for ${device.name}`} page="main" onClose={close}>
          <MenuItem label="Rename" onSelect={choose(() => setRenaming(true), false)} />
          {device.passkeys.length > 0 && (
            <MenuItem
              label="Remove passkeys"
              onSelect={choose(() => removePasskeys.mutate(), true)}
            />
          )}
          <MenuItem
            danger
            label={device.duplicateOf ? 'Remove old entry' : 'Revoke'}
            onSelect={choose(() => revoke.mutate(), false)}
          />
        </MenuShell>
      )}
      {errors.map((error) => (
        <p key={error.message} className="ph-error" role="alert">
          {error.message}
        </p>
      ))}
    </li>
  );
}

import { useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  REMOTE_MAC_ONLY_SWITCHES,
  REMOTE_SIGN_IN_SWITCHES,
  REMOTE_SWITCH_LABELS,
  type RemoteSession,
  type RemoteSwitch,
  type RemoteSwitches,
} from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { phoneApi, phoneKeys } from './phone-api.ts';

const SHOWN = (Object.keys(REMOTE_SWITCH_LABELS) as RemoteSwitch[]).filter(
  (id) => !REMOTE_MAC_ONLY_SWITCHES.includes(id) && !REMOTE_SIGN_IN_SWITCHES.includes(id),
);

export const MAC_ONLY_LINE = 'The Browser pane, preview and terminal stay on the Mac.';

interface SwitchRowProps {
  id: RemoteSwitch;
  checked: boolean;
  label?: string;
}

export function SwitchRow({ id, checked, label = REMOTE_SWITCH_LABELS[id] }: SwitchRowProps) {
  const queryClient = useQueryClient();
  const switchId = useId();
  const change = useMutation({
    mutationFn: (next: boolean) => phoneApi.setSwitches({ [id]: next }),
    onSuccess: (switches) => {
      queryClient.setQueryData<RemoteSession>(phoneKeys.session, (session) =>
        session ? { ...session, switches } : session,
      );
      void queryClient.invalidateQueries({ queryKey: phoneKeys.audit });
    },
  });
  return (
    <li className="ph-switch">
      <label htmlFor={switchId}>{label}</label>
      <BlobToggle
        id={switchId}
        size="sm"
        label={label}
        checked={change.isPending ? change.variables : checked}
        disabled={change.isPending}
        onChange={(next) => change.mutate(next)}
      />
      {change.error && (
        <p className="ph-error" role="alert">
          {change.error.message}
        </p>
      )}
    </li>
  );
}

export function PhoneSwitches({ switches }: { switches: RemoteSwitches }) {
  return (
    <section className="ph-card" aria-labelledby="ph-switches-title">
      <h2 id="ph-switches-title">What paired devices can do</h2>
      <p className="ph-note">
        A paired device can read chats, send messages and answer cards. {MAC_ONLY_LINE} Pairing,
        devices and these switches can only be changed here.
      </p>
      <ul className="ph-switches">
        {SHOWN.map((id) => (
          <SwitchRow key={id} id={id} checked={switches[id]} />
        ))}
      </ul>
    </section>
  );
}

export function PhoneSwitchesReadOnly({ switches }: { switches: RemoteSwitches }) {
  return (
    <section className="ph-card ph-readonly" aria-labelledby="ph-switches-title">
      <h2 id="ph-switches-title">What this device can do</h2>
      <p className="ph-note">{MAC_ONLY_LINE} Change these on your Mac.</p>
      <ul className="ph-switches">
        {SHOWN.map((id) => (
          <li key={id} className="ph-switch">
            <span>{REMOTE_SWITCH_LABELS[id]}</span>
            <span className={switches[id] ? 'ph-state on' : 'ph-state'}>
              {switches[id] ? 'On' : 'Off'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

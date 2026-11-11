import { Fragment, useId, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  REMOTE_ALWAYS_ALLOWED_LINE,
  REMOTE_SWITCH_LABELS,
  type RemoteSession,
  type RemoteSwitch,
  type RemoteSwitches,
} from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { phoneApi, phoneKeys } from './phone-api.ts';
import { groupCount, labelsByState, MAC_ONLY_LINE, shownGroups } from './switch-groups.ts';

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

interface PhoneSwitchesProps {
  switches: RemoteSwitches;
  notificationsExtra?: ReactNode;
}

function FixedRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ph-fixed">
      <span className="ph-fixed-label">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function SwitchGroup({
  group,
  switches,
  notificationsExtra,
}: {
  group: ReturnType<typeof shownGroups>[number];
  switches: RemoteSwitches;
  notificationsExtra: ReactNode;
}) {
  const headingId = useId();
  return (
    <div className="ph-group" role="group" aria-labelledby={headingId}>
      <div className="ph-group-head">
        <h3 id={headingId}>{group.title}</h3>
        <span className="ph-group-count">{groupCount(group.switches, switches)}</span>
        <p>{group.description}</p>
      </div>
      <ul className="ph-switches ph-switch-grid">
        {group.switches.map((id) => (
          <Fragment key={id}>
            <SwitchRow id={id} checked={switches[id]} />
            {id === 'notifications' && notificationsExtra && (
              <li className="ph-switch-extra">{notificationsExtra}</li>
            )}
          </Fragment>
        ))}
      </ul>
    </div>
  );
}

export function PhoneSwitches({ switches, notificationsExtra }: PhoneSwitchesProps) {
  return (
    <section className="ph-card ph-switches-card" aria-labelledby="ph-switches-title">
      <h2 id="ph-switches-title">What paired devices can do</h2>
      <p className="ph-note">Pairing, devices and these switches can only be changed here.</p>
      <FixedRow label="Always">{REMOTE_ALWAYS_ALLOWED_LINE}</FixedRow>
      {shownGroups().map((group) => (
        <SwitchGroup
          key={group.id}
          group={group}
          switches={switches}
          notificationsExtra={switches.notifications ? notificationsExtra : null}
        />
      ))}
      <FixedRow label="Never">{MAC_ONLY_LINE}</FixedRow>
    </section>
  );
}

export function PhoneSwitchesReadOnly({ switches }: { switches: RemoteSwitches }) {
  const { allowed, off } = labelsByState(switches);
  return (
    <section className="ph-card ph-readonly" aria-labelledby="ph-switches-title">
      <h2 id="ph-switches-title">What this device can do</h2>
      <p className="ph-note">Change these on your Mac.</p>
      <div className="ph-can">
        <h3>Allowed</h3>
        <ul>
          <li>{REMOTE_ALWAYS_ALLOWED_LINE}</li>
          {allowed.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </div>
      <div className="ph-can">
        <h3>Off on your Mac</h3>
        {off.length === 0 ? (
          <p className="ph-note">Nothing is off.</p>
        ) : (
          <ul>
            {off.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="ph-can">
        <h3>Only on the Mac</h3>
        <p className="ph-note">{MAC_ONLY_LINE}</p>
      </div>
    </section>
  );
}

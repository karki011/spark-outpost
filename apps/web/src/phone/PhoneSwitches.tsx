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
import { PhoneGroup, PhoneSection } from './PhoneSection.tsx';
import {
  groupCount,
  labelsByState,
  hostOnlyLine,
  notifyAwayOnlyNote,
  NOTIFY_UPDATES_NOTE,
  SHOWN_SWITCHES,
  shownGroups,
} from './switch-groups.ts';
import { hostWords } from '../desktop/host-words.ts';

interface SwitchRowProps {
  id: RemoteSwitch;
  checked: boolean;
  label?: string;
  disabled?: boolean;
  note?: string;
}

export function SwitchRow({
  id,
  checked,
  label = REMOTE_SWITCH_LABELS[id],
  disabled = false,
  note,
}: SwitchRowProps) {
  const queryClient = useQueryClient();
  const switchId = useId();
  const noteId = useId();
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
        disabled={disabled || change.isPending}
        {...(note ? { describedBy: noteId } : {})}
        onChange={(next) => change.mutate(next)}
      />
      {note && (
        <p id={noteId} className="ph-note">
          {note}
        </p>
      )}
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
  cards: ReactNode;
}

function FixedRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ph-fixed">
      <span className="ph-fixed-label">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function notifyNotes(): Partial<Record<RemoteSwitch, string>> {
  return { notifyUpdates: NOTIFY_UPDATES_NOTE, notifyAwayOnly: notifyAwayOnlyNote() };
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
  const notes = notifyNotes();
  return (
    <PhoneGroup
      id={`group-${group.id}`}
      title={group.title}
      description={group.description}
      count={groupCount(group.switches, switches)}
    >
      <ul className="ph-switches ph-switch-grid">
        {group.switches.map((id) => {
          const note = notes[id];
          return (
            <Fragment key={id}>
              {note ? (
                <SwitchRow
                  id={id}
                  checked={switches[id]}
                  disabled={!switches.notifications && !switches[id]}
                  note={note}
                />
              ) : (
                <SwitchRow id={id} checked={switches[id]} />
              )}
              {id === 'notifications' && notificationsExtra && (
                <li className="ph-switch-extra">{notificationsExtra}</li>
              )}
            </Fragment>
          );
        })}
      </ul>
    </PhoneGroup>
  );
}

export function PhoneSwitches({ switches, notificationsExtra, cards }: PhoneSwitchesProps) {
  return (
    <PhoneSection
      id="switches"
      title="What paired devices can do"
      className="ph-switches-card"
      summary={<span className="ph-pill">{groupCount(SHOWN_SWITCHES, switches)}</span>}
    >
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
      {cards}
      <FixedRow label="Never">{hostOnlyLine()}</FixedRow>
    </PhoneSection>
  );
}

export function PhoneSwitchesReadOnly({ switches }: { switches: RemoteSwitches }) {
  const { allowed, off } = labelsByState(switches);
  return (
    <section className="ph-card ph-readonly" aria-labelledby="ph-switches-title">
      <h2 id="ph-switches-title">What this device can do</h2>
      <p className="ph-note">Change these on your {hostWords().computer}.</p>
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
        <h3>Off on your {hostWords().computer}</h3>
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
        <h3>Only on the {hostWords().computer}</h3>
        <p className="ph-note">{hostOnlyLine()}</p>
      </div>
    </section>
  );
}

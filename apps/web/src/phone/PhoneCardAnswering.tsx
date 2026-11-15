import { useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  REMOTE_CARD_KINDS,
  REMOTE_CARD_KIND_LABELS,
  remoteKindOn,
  type RemoteCardAnswering,
  type RemoteCardKind,
  type RemoteSession,
} from '@spark-outpost/contracts';
import { phoneApi, phoneKeys } from './phone-api.ts';

export const CARD_STEP_UP_NOTE =
  'Spark rules, Mac control and press-and-hold cards also ask for that device’s passkey. A device without a passkey shows Answer on your Mac.';
export const CARDS_FIXED_LINE =
  'Open-address cards, browser sign-in handoffs and changes to your company’s rules file.';

const FROM_CHOICES: { value: RemoteCardAnswering['from']; label: string }[] = [
  { value: 'mac', label: 'Mac only' },
  { value: 'devices', label: 'Paired devices' },
];

function toggled(list: readonly RemoteCardKind[], kind: RemoteCardKind, keep: boolean) {
  return keep ? [...new Set([...list, kind])] : list.filter((item) => item !== kind);
}

export function PhoneCardAnswering({ answering }: { answering: RemoteCardAnswering }) {
  const queryClient = useQueryClient();
  const name = useId();
  const [draft, setDraft] = useState<RemoteCardAnswering | null>(null);
  const saving = useRef(0);
  const change = useMutation({
    mutationFn: phoneApi.setCardAnswering,
    scope: { id: 'card-answering' },
    onSuccess: (cardAnswering) => {
      queryClient.setQueryData<RemoteSession>(phoneKeys.session, (session) =>
        session ? { ...session, cardAnswering } : session,
      );
      void queryClient.invalidateQueries({ queryKey: phoneKeys.audit });
    },
  });
  const shown = draft ?? answering;
  const save = (next: Partial<RemoteCardAnswering>) => {
    setDraft({ ...shown, ...next });
    saving.current += 1;
    change.mutate(next, {
      onSettled: () => {
        saving.current -= 1;
        if (saving.current === 0) setDraft(null);
      },
    });
  };
  const onMac = shown.from === 'mac';
  return (
    <section className="ph-card ph-cards-card" aria-labelledby="ph-cards-title">
      <h2 id="ph-cards-title">Cards can be answered from</h2>
      <p className="ph-note">
        Sparks and workflows, plugins, calendar, Spark rules and Mac control cards. Other cards
        follow the switches below.
      </p>
      <div className="ph-cards-from" role="radiogroup" aria-labelledby="ph-cards-title">
        {FROM_CHOICES.map((choice) => (
          <label key={choice.value} className="ph-choice">
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={shown.from === choice.value}
              onChange={() => save({ from: choice.value })}
            />
            {choice.label}
          </label>
        ))}
      </div>
      <fieldset className="ph-cards-kinds" disabled={onMac}>
        <legend>Keep on the Mac</legend>
        {REMOTE_CARD_KINDS.map((kind) => (
          <label key={kind} className="ph-choice">
            <input
              type="checkbox"
              checked={shown.macOnly.includes(kind)}
              onChange={(event) =>
                save({ macOnly: toggled(shown.macOnly, kind, event.target.checked) })
              }
            />
            {REMOTE_CARD_KIND_LABELS[kind]}
          </label>
        ))}
      </fieldset>
      <p className="ph-note">{CARD_STEP_UP_NOTE}</p>
      <div className="ph-fixed">
        <span className="ph-fixed-label">Mac only</span>
        <span>{CARDS_FIXED_LINE}</span>
      </div>
      {change.error && (
        <p className="ph-error" role="alert">
          {change.error.message}
        </p>
      )}
    </section>
  );
}

export function PhoneCardAnsweringReadOnly({ session }: { session: RemoteSession }) {
  const here = REMOTE_CARD_KINDS.filter((kind) => remoteKindOn(session.cardAnswering, kind));
  const labels = here.map((kind) => REMOTE_CARD_KIND_LABELS[kind]);
  return (
    <section className="ph-card" aria-labelledby="ph-cards-title">
      <h2 id="ph-cards-title">Cards you can answer here</h2>
      <p className="ph-note">
        {labels.length === 0
          ? 'Sparks and workflows, plugins, calendar, Spark rules and Mac control cards are answered on your Mac.'
          : `${labels.join(', ')} cards can be answered here.`}{' '}
        {session.passkey
          ? 'Spark rules, Mac control and press-and-hold cards ask for this device’s passkey.'
          : 'Spark rules, Mac control and press-and-hold cards need a passkey on this device.'}
      </p>
    </section>
  );
}

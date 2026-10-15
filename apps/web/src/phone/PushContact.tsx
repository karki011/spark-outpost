import { useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PUSH_CONTACT_DEFAULT, PUSH_CONTACT_MAX } from '@spark-outpost/contracts';
import { relativeTime } from '../ui/relative-time.ts';
import { phoneApi, phoneKeys } from './phone-api.ts';
import { CONTACT_LABEL, CONTACT_PURPOSE, pushFailureLine } from './phone-copy.ts';

function shownContact(contact: string | null): string {
  return contact?.replace(/^mailto:/, '') ?? '';
}

export function PushContact({ poll }: { poll: number | false }) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);
  const state = useQuery({
    queryKey: phoneKeys.pushContact,
    queryFn: phoneApi.pushContact,
    refetchInterval: poll,
  });
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (contact: string | null) => phoneApi.savePushContact(contact),
    onSuccess: (next) => {
      queryClient.setQueryData(phoneKeys.pushContact, next);
      setDraft(null);
      field.current?.focus();
      void queryClient.invalidateQueries({ queryKey: phoneKeys.audit });
    },
  });
  if (!state.data) return null;
  const saved = shownContact(state.data.contact);
  const value = draft ?? saved;
  const changed = value.trim() !== saved;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (changed) save.mutate(value.trim() === '' ? null : value.trim());
  };
  return (
    <div className="ph-push-contact">
      <label htmlFor={fieldId}>{CONTACT_LABEL}</label>
      <p className="ph-note">{CONTACT_PURPOSE}</p>
      <form className="ph-rename" onSubmit={submit}>
        <input
          ref={field}
          id={fieldId}
          className="inp"
          type="text"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          placeholder={PUSH_CONTACT_DEFAULT}
          value={value}
          maxLength={PUSH_CONTACT_MAX}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="btn primary sm" disabled={save.isPending || !changed}>
          Save
        </button>
      </form>
      <p className="ph-note">
        In use: <code>{shownContact(state.data.inUse)}</code>
      </p>
      {save.error && (
        <p className="ph-error" role="alert">
          {save.error.message}
        </p>
      )}
      {state.data.failures.length > 0 && (
        <ul className="ph-push-failures">
          {state.data.failures.map((failure) => (
            <li key={`${failure.deviceName}-${failure.at}`} className="ph-error">
              {pushFailureLine(failure)}{' '}
              <time dateTime={failure.at}>{relativeTime(failure.at)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

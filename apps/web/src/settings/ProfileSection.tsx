import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DISPLAY_NAME_MAX_LENGTH } from '@spark-outpost/contracts';
import { setupApi, setupKey } from '../api/setup.ts';
import { UserBlob } from '../brand/UserBlob.tsx';

const SAVE_DELAY_MS = 400;

export function ProfileSection({ displayName }: { displayName: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(displayName);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const save = useMutation({
    mutationFn: (value: string) => setupApi.updateProfile({ displayName: value }),
    onSuccess: (state) => queryClient.setQueryData(setupKey, state),
  });

  useEffect(() => () => clearTimeout(timer.current), []);

  const change = (value: string) => {
    setName(value);
    clearTimeout(timer.current);
    if (value.trim() === '') return;
    timer.current = setTimeout(() => save.mutate(value), SAVE_DELAY_MS);
  };

  return (
    <>
      <p className="lede">How you appear in chats.</p>
      <div className="set-profile">
        <UserBlob displayName={name} size={48} animate="always" />
        <b>{name.trim() || 'Your name'}</b>
      </div>
      <label className="field">
        <span>Name</span>
        <input
          className="inp"
          value={name}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          autoComplete="given-name"
          onChange={(event) => change(event.target.value)}
        />
      </label>
      <p className="set-hint" aria-live="polite">
        {name.trim() === ''
          ? 'Enter a name to save it.'
          : save.isError
            ? save.error.message
            : save.isPending
              ? 'Saving…'
              : 'Changes save automatically.'}
      </p>
    </>
  );
}

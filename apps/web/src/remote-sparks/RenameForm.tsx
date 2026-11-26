import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { REMOTE_SPARK_NAME_MAX } from '@spark-outpost/contracts';
import { remoteSparkKeys } from './remote-sparks-api.ts';

interface RenameFormProps {
  label: string;
  initial: string;
  allowEmpty?: boolean;
  save: (name: string) => Promise<void>;
  onDone: () => void;
}

export function RenameForm({ label, initial, allowEmpty, save, onDone }: RenameFormProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial);
  const usable = allowEmpty === true || name.trim() !== '';
  const rename = useMutation({
    mutationFn: () => save(name.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: remoteSparkKeys.all });
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (usable) rename.mutate();
  };
  return (
    <form className="ph-rename" onSubmit={submit}>
      <input
        className="inp"
        aria-label={label}
        value={name}
        maxLength={REMOTE_SPARK_NAME_MAX}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone();
        }}
      />
      <button type="submit" className="btn primary sm" disabled={rename.isPending || !usable}>
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

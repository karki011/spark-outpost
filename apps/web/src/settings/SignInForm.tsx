import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Project, SavedSignIn } from '@spark-outpost/contracts';
import { signInKeys, signInsApi } from '../api/sign-ins.ts';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { checkedSignIn, draftOf, type SignInField } from './sign-in-draft.ts';

interface FieldSpec {
  field: SignInField;
  label: string;
  placeholder: string;
  type: 'text' | 'password';
}

function fieldsFor(saved: SavedSignIn | null): readonly FieldSpec[] {
  const kept = saved !== null && saved.username !== null;
  return [
    { field: 'label', label: 'Label', placeholder: 'Staging admin', type: 'text' },
    { field: 'origin', label: 'Site', placeholder: 'https://staging.example.com', type: 'text' },
    {
      field: 'username',
      label: 'Username',
      placeholder: kept ? `Leave empty to keep ${saved.username}` : 'test@example.com',
      type: 'text',
    },
    {
      field: 'password',
      label: 'Password',
      placeholder: kept ? 'Saved in the keychain. Leave empty to keep it' : '',
      type: 'password',
    },
  ];
}

interface SignInFormProps {
  project: Project;
  saved: SavedSignIn | null;
  onDone: () => void;
}

export function SignInForm({ project, saved, onDone }: SignInFormProps) {
  const ids = useId();
  const queryClient = useQueryClient();
  const first = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => draftOf(saved));
  const [submitted, setSubmitted] = useState(false);
  const { request, errors } = checkedSignIn(draft, saved);
  const finish = () => {
    void queryClient.invalidateQueries({ queryKey: signInKeys.project(project.id) });
    onDone();
  };
  const save = useMutation({
    mutationFn: async () => {
      if (!request) return null;
      if (saved) return signInsApi.update(project.id, saved.id, request);
      const { username = '', password = '' } = request;
      return signInsApi.create(project.id, { ...request, username, password });
    },
    onSuccess: finish,
  });
  const remove = useMutation({
    mutationFn: () => signInsApi.remove(project.id, saved!.id),
    onSuccess: finish,
  });
  const busy = save.isPending || remove.isPending;
  const failure = save.error ?? remove.error;

  useEffect(() => {
    first.current?.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (request) save.mutate();
  };

  return (
    <form
      className="pv-form signin-form"
      aria-label={
        saved ? `Sign-in ${saved.label} of ${project.name}` : `New sign-in for ${project.name}`
      }
      noValidate
      onSubmit={submit}
    >
      {fieldsFor(saved).map(({ field, label, placeholder, type }, index) => {
        const error = submitted ? errors[field] : undefined;
        return (
          <div className="field" key={field}>
            <label htmlFor={`${ids}-${field}`}>{label}</label>
            <input
              ref={index === 0 ? first : undefined}
              id={`${ids}-${field}`}
              className={type === 'password' ? 'inp' : 'inp mono'}
              type={type}
              value={draft[field]}
              placeholder={placeholder}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete={type === 'password' ? 'new-password' : 'off'}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${ids}-${field}-error` : `${ids}-note`}
              onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
            />
            {error && (
              <small className="pv-error" id={`${ids}-${field}-error`}>
                {error}
              </small>
            )}
          </div>
        );
      })}
      <p className="set-hint" id={`${ids}-note`}>
        Use test accounts only. The username and password are stored in the Mac keychain, and agents
        never see them: Spark types them into this site when you allow it.
      </p>
      {failure && (
        <p className="set-hint" role="alert">
          {failure.message}
        </p>
      )}
      <div className="pv-foot">
        <button type="button" className="btn line sm" disabled={busy} onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn primary sm" disabled={busy}>
          {saved ? 'Save sign-in' : 'Add sign-in'}
        </button>
      </div>
      {saved && (
        <HoldToConfirm
          label={`Hold to delete ${saved.label}`}
          hint="Deletes this sign-in and its keychain entry. It cannot be undone."
          holdingHint="Keep holding. Let go now to cancel."
          releasedHint="Released early. Nothing happened."
          disabled={busy}
          onConfirm={() => remove.mutate()}
        />
      )}
    </form>
  );
}

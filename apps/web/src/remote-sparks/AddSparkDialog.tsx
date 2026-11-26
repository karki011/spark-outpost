import './remote-sparks.css';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { REMOTE_SPARK_NAME_MAX } from '@spark-outpost/contracts';
import { ModalFrame } from '../ui/ModalFrame.tsx';
import { remoteSparkKeys, remoteSparksApi } from './remote-sparks-api.ts';
import { ADD_SPARK, NAME_PROBLEM, addressHint, addressProblem } from './remote-sparks-copy.ts';

interface AddSparkDialogProps {
  ownHostname: string | null;
  onClose: () => void;
}

export function AddSparkDialog({ ownHostname, onClose }: AddSparkDialogProps) {
  const ids = useId();
  const queryClient = useQueryClient();
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [tried, setTried] = useState(false);
  const addressField = useRef<HTMLInputElement>(null);
  const typed = address.trim() !== '';
  const problem = typed || tried ? addressProblem(address, ownHostname) : null;
  const hint = addressHint(address, ownHostname);
  const nameProblem = tried && name.trim() === '' ? NAME_PROBLEM : null;
  const add = useMutation({
    mutationFn: () => remoteSparksApi.add({ address: address.trim(), name: name.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: remoteSparkKeys.all });
      onClose();
    },
    onError: () => addressField.current?.focus(),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    const ready = addressProblem(address, ownHostname) === null && name.trim() !== '';
    if (ready && !add.isPending) add.mutate();
  };
  const formId = `${ids}-form`;
  return (
    <ModalFrame
      className="rs-dialog"
      labelledBy={`${ids}-title`}
      busy={add.isPending}
      failure={add.error?.message ?? null}
      footClassName="rs-foot"
      foot={
        <>
          <button type="button" className="btn line sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn primary sm" disabled={add.isPending}>
            {add.isPending ? 'Adding…' : ADD_SPARK}
          </button>
        </>
      }
      onClose={onClose}
    >
      <h2 id={`${ids}-title`}>{ADD_SPARK}</h2>
      <form id={formId} className="rs-form" noValidate onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${ids}-address`}>Address or pairing link</label>
          <input
            ref={addressField}
            id={`${ids}-address`}
            className="inp"
            data-autofocus
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={address}
            maxLength={400}
            aria-invalid={problem !== null}
            aria-describedby={`${ids}-address-note`}
            onChange={(event) => setAddress(event.target.value)}
          />
          <p id={`${ids}-address-note`} className={problem ? 'rs-problem' : 'rs-hint'}>
            {problem ?? hint ?? 'Copy it from Remote control on the other Mac.'}
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-name`}>Name</label>
          <input
            id={`${ids}-name`}
            className="inp"
            placeholder="Studio Mac"
            value={name}
            maxLength={REMOTE_SPARK_NAME_MAX}
            aria-invalid={nameProblem !== null}
            aria-describedby={nameProblem ? `${ids}-name-note` : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          {nameProblem && (
            <p id={`${ids}-name-note`} className="rs-problem">
              {nameProblem}
            </p>
          )}
        </div>
      </form>
    </ModalFrame>
  );
}

import { useId, type Ref } from 'react';
import { OUTPOST_NAME_MAX } from '@spark-outpost/contracts';

interface StepNameProps {
  inputRef: Ref<HTMLInputElement>;
  name: string;
  problem: string | null;
  onName: (name: string) => void;
}

export function StepName({ inputRef, name, problem, onName }: StepNameProps) {
  const ids = useId();
  return (
    <section className="op-step" aria-label="Name">
      <p className="op-step-lede">
        A shared room where you ask chats for work and read their answers in one thread. Each chat
        keeps its own project, agent, mode and branch.
      </p>
      <label className="field">
        <span>Name</span>
        <input
          ref={inputRef}
          className="inp"
          value={name}
          maxLength={OUTPOST_NAME_MAX}
          aria-invalid={problem !== null}
          aria-describedby={problem ? `${ids}problem` : `${ids}hint`}
          onChange={(event) => onName(event.target.value)}
        />
        {problem ? (
          <small id={`${ids}problem`} className="op-problem">
            {problem}
          </small>
        ) : (
          <small id={`${ids}hint`} className="op-field-hint">
            You can rename it later.
          </small>
        )}
      </label>
    </section>
  );
}

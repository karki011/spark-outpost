import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { WORKFLOW_NAME_MAX, type WorkflowStep } from '@spark-outpost/contracts';
import { RadioRow } from '../ui/RadioRow.tsx';
import type { WorkflowSuggestion } from './workflow-suggestions.ts';

interface NewWorkflowProps {
  suggestions: readonly WorkflowSuggestion[];
  onCancel: () => void;
  onCreate: (name: string, steps: WorkflowStep[]) => void;
}

const BLANK = 'blank';
const STEPS: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

export function NewWorkflow({ suggestions, onCancel, onCreate }: NewWorkflowProps) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [from, setFrom] = useState(BLANK);
  const [touched, setTouched] = useState(false);
  const options = [BLANK, ...suggestions.map((suggestion) => suggestion.id)];
  const missing = name.trim() === '';

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (missing) {
      nameRef.current?.focus();
      return;
    }
    const picked = suggestions.find((suggestion) => suggestion.id === from);
    onCreate(name.trim(), picked ? picked.steps : []);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (options.indexOf(from) + step + options.length) % options.length;
    setFrom(options[next]!);
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <form className="wf-new" aria-labelledby={`${id}-title`} onSubmit={submit} noValidate>
      <h2 id={`${id}-title`}>New workflow</h2>
      <label className="field" htmlFor={`${id}-name`}>
        <span>Name</span>
        <input
          ref={nameRef}
          id={`${id}-name`}
          className="inp"
          value={name}
          maxLength={WORKFLOW_NAME_MAX}
          placeholder="Pre-PR review"
          aria-invalid={(touched && missing) || undefined}
          aria-describedby={touched && missing ? `${id}-name-problem` : undefined}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {touched && missing && (
        <p className="wf-field-problem" id={`${id}-name-problem`} role="alert">
          Give the workflow a name.
        </p>
      )}
      <div className="field">
        <span id={`${id}-from`}>Start from</span>
        <div
          className="rlist"
          role="radiogroup"
          aria-labelledby={`${id}-from`}
          onKeyDown={onKeyDown}
        >
          <RadioRow
            id={`${id}-blank`}
            label="Blank"
            hint="Add Sparks and stages yourself."
            checked={from === BLANK}
            onSelect={() => setFrom(BLANK)}
          />
          {suggestions.map((suggestion) => (
            <RadioRow
              key={suggestion.id}
              id={`${id}-${suggestion.id}`}
              label={suggestion.name}
              hint={suggestion.detail}
              checked={from === suggestion.id}
              onSelect={() => setFrom(suggestion.id)}
            />
          ))}
        </div>
      </div>
      <p className="wf-hint">The workflow opens in the editor. Nothing runs until you press Run.</p>
      <div className="wf-new-acts">
        <button type="button" className="btn line" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary">
          Open in editor
        </button>
      </div>
    </form>
  );
}

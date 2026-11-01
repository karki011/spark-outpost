import { useEffect, useRef, useState } from 'react';
import { BROWSER_NAME_MAX } from '@spark-outpost/contracts';

interface NameFormProps {
  label: string;
  start: string;
  onSave(name: string): void;
  onCancel(): void;
}

export function NameForm({ label, start, onSave, onCancel }: NameFormProps) {
  const [name, setName] = useState(start);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <form
      className="bv-name-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() !== '') onSave(name.trim());
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <input
        ref={input}
        className="bv-name-input"
        aria-label={label}
        placeholder={label}
        maxLength={BROWSER_NAME_MAX}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button type="submit" className="btn" disabled={name.trim() === ''}>
        Save
      </button>
      <button type="button" className="btn" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

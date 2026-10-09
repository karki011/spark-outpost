import type { Ref } from 'react';

interface HandleInputProps {
  ref?: Ref<HTMLInputElement>;
  value: string;
  label: string;
  invalid: boolean;
  describedBy?: string | undefined;
  onChange: (typed: string) => void;
}

export function HandleInput({
  ref,
  value,
  label,
  invalid,
  describedBy,
  onChange,
}: HandleInputProps) {
  return (
    <span className="op-handle-field">
      <span aria-hidden="true">@</span>
      <input
        ref={ref}
        className="inp"
        value={value}
        placeholder="handle"
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  );
}

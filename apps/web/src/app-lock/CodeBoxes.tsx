import './code-boxes.css';
import type { Ref } from 'react';
import { CODE_LENGTH, normalizeCode } from './lock-code.ts';

interface CodeBoxesProps {
  id: string;
  value: string;
  onChange: (code: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string | undefined;
  shakes?: number;
}

const CELLS = Array.from({ length: CODE_LENGTH }, (_, index) => index);

export function CodeBoxes({
  id,
  value,
  onChange,
  inputRef,
  disabled = false,
  invalid = false,
  describedBy,
  shakes = 0,
}: CodeBoxesProps) {
  return (
    <div className="code-boxes" data-invalid={invalid || undefined}>
      <input
        ref={inputRef}
        id={id}
        className="code-input"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(normalizeCode(event.target.value))}
      />
      <div
        key={shakes}
        className="code-cells"
        data-shake={shakes > 0 || undefined}
        aria-hidden="true"
      >
        {CELLS.map((index) => (
          <span
            key={index}
            className="code-cell"
            data-filled={index < value.length || undefined}
            data-active={index === Math.min(value.length, CODE_LENGTH - 1) || undefined}
          />
        ))}
      </div>
    </div>
  );
}

import { useState } from 'react';

interface ConfirmButtonProps {
  label: string;
  what: string;
  onConfirm: () => void;
}

export function ConfirmButton({ label, what, onConfirm }: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        className="btn sm line"
        aria-label={`${label} ${what}…`}
        onClick={() => setAsking(true)}
      >
        {label}…
      </button>
    );
  }
  return (
    <span className="op-confirm" role="group" aria-label={`${label} ${what}?`}>
      <button
        type="button"
        className="btn sm danger"
        autoFocus
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {label}
      </button>
      <button type="button" className="btn sm line" onClick={() => setAsking(false)}>
        Keep
      </button>
    </span>
  );
}

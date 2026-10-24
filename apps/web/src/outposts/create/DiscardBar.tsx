import { useEffect, useId, useRef } from 'react';

interface DiscardBarProps {
  question: string;
  onKeep: () => void;
  onDiscard: () => void;
}

export function DiscardBar({ question, onKeep, onDiscard }: DiscardBarProps) {
  const id = useId();
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  return (
    <footer className="op-sheet-foot op-create-foot" role="alertdialog" aria-labelledby={id}>
      <span id={id} className="op-foot-ask">
        {question}
      </span>
      <button ref={keepRef} type="button" className="btn sm ghost" onClick={onKeep}>
        Keep editing
      </button>
      <button type="button" className="btn sm line" onClick={onDiscard}>
        Discard
      </button>
    </footer>
  );
}

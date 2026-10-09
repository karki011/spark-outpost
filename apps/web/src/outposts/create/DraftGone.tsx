import '../outposts.css';
import '../outpost-sheet.css';
import { useEffect, useId, useRef } from 'react';

interface DraftGoneProps {
  message: string;
  onClose: () => void;
}

export function DraftGone({ message, onClose }: DraftGoneProps) {
  const ids = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  return (
    <div
      className="op-scrim"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="op-sheet"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${ids}title`}
        aria-describedby={`${ids}text`}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' && event.key !== 'Tab') return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
        }}
      >
        <header className="op-sheet-head">
          <h2 id={`${ids}title`}>This draft cannot be started</h2>
        </header>
        <div className="op-sheet-body">
          <p id={`${ids}text`} className="op-sheet-note">
            {message}
          </p>
        </div>
        <footer className="op-sheet-foot">
          <button ref={closeRef} type="button" className="btn sm primary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

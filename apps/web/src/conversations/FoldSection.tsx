import './fold-section.css';
import { useId, type ReactNode } from 'react';
import { ChevronIcon } from '../ui/icons.tsx';

interface FoldSectionProps {
  label: string;
  open: boolean;
  bucket?: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function FoldSection({ label, open, bucket = false, onToggle, children }: FoldSectionProps) {
  const bodyId = useId();
  const classes = ['fold', bucket ? 'bucket' : '', open ? 'open' : ''].filter(Boolean);
  return (
    <section className={classes.join(' ')} aria-label={label}>
      <div className="sec">
        <button
          type="button"
          className="sec-head"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span>{label}</span>
          <ChevronIcon />
        </button>
      </div>
      <div className="fold-body" id={bodyId} inert={!open}>
        <div>{children}</div>
      </div>
    </section>
  );
}

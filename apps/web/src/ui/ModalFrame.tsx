import './modal-frame.css';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { wrapTabFocus } from './focus-trap.ts';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled])';

interface ModalFrameProps {
  className: string;
  role?: 'dialog' | 'alertdialog';
  labelledBy: string;
  describedBy?: string;
  busy?: boolean;
  failure?: string | null;
  foot: ReactNode;
  footClassName: string;
  onClose: () => void;
  children: ReactNode;
}

export function ModalFrame({
  className,
  role = 'dialog',
  labelledBy,
  describedBy,
  busy = false,
  failure = null,
  foot,
  footClassName,
  onClose,
  children,
}: ModalFrameProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    const panel = event.currentTarget;
    wrapTabFocus(event, () => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]);
  };
  return createPortal(
    <div
      className="modal-scrim"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <div
        ref={panelRef}
        className={`modal-panel ${className}`}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onKeyDown={onKeyDown}
      >
        {children}
        {failure && (
          <p className="modal-failure" role="alert">
            {failure}
          </p>
        )}
        <div className={footClassName}>{foot}</div>
      </div>
    </div>,
    document.body,
  );
}

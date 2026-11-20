import '../pull-request/pr-card.css';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { CheckIcon, ChevronIcon } from '../../ui/icons.tsx';

interface DockItemProps {
  className: string;
  label: string;
  toggleLabel: string;
  icon: ReactNode;
  row: ReactNode;
  panel: ReactNode;
  trailing?: ReactNode;
  note?: string | null;
  status?: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DockItem({
  className,
  label,
  toggleLabel,
  icon,
  row,
  panel,
  trailing,
  note = null,
  status = null,
  open: openProp,
  onOpenChange,
}: DockItemProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const toggle = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOwnOpen(false);
      onOpenChange?.(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!item.current?.contains(event.target as Node)) close();
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && document.activeElement === document.body) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open, onOpenChange]);
  const onRowClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('a, button')) return;
    setOpen(!open);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    setOpen(false);
    toggle.current?.focus();
  };
  return (
    <div
      ref={item}
      className={open ? `${className} expanded` : className}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      <div className="prc-row" onClick={onRowClick}>
        <button
          ref={toggle}
          type="button"
          className="prc-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={toggleLabel}
          onClick={() => setOpen(!open)}
        >
          <ChevronIcon />
          {icon}
        </button>
        {row}
        {trailing}
      </div>
      {note && (
        <p className="prc-problem" role="alert">
          {note}
        </p>
      )}
      {status && (
        <p className="prc-clean">
          <CheckIcon />
          {status}
        </p>
      )}
      {open && (
        <div id={panelId} className="prc-panel">
          {panel}
        </div>
      )}
    </div>
  );
}

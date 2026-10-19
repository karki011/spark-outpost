import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon } from '../ui/icons.tsx';
import { clampStart, VIEWPORT_MARGIN } from '../ui/viewport-clamp.ts';

export interface MenuAnchor {
  x: number;
  y: number;
  above: number;
  focusBack: HTMLElement | null;
}

interface ItemProps {
  icon?: ReactNode;
  label: string;
  danger?: boolean;
  checked?: boolean;
  trailing?: ReactNode;
  disabled?: boolean;
  title?: string | undefined;
  onSelect: () => void;
}

export function MenuItem({
  icon,
  label,
  danger,
  checked,
  trailing,
  disabled,
  title,
  onSelect,
}: ItemProps) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      className={danger ? 'danger' : undefined}
      disabled={disabled}
      title={title}
      onClick={onSelect}
    >
      {icon}
      <span>{label}</span>
      {checked && (
        <span className="tk">
          <CheckIcon className="tick" />
        </span>
      )}
      {trailing}
    </button>
  );
}

function moveFocus(menu: HTMLElement, key: string): void {
  const items = [...menu.querySelectorAll<HTMLElement>('button:not(:disabled), input')];
  const index = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  const next =
    key === 'Home' ? 0 : key === 'End' ? last : key === 'ArrowDown' ? index + 1 : index - 1;
  items[next > last ? 0 : next < 0 ? last : next]?.focus();
}

interface MenuShellProps {
  anchor: MenuAnchor;
  label: string;
  page: string;
  onClose: () => void;
  onKey?: (event: KeyboardEvent<HTMLDivElement>) => boolean;
  className?: string;
  children: ReactNode;
}

export function MenuShell({
  anchor,
  label,
  page,
  onClose,
  onKey,
  className,
  children,
}: MenuShellProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y, origin: 'top left' });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { offsetWidth: width, offsetHeight: height } = menu;
    const left = clampStart(anchor.x, width, innerWidth);
    const fitsBelow = anchor.y + height <= innerHeight - VIEWPORT_MARGIN;
    const top = fitsBelow ? anchor.y : Math.max(VIEWPORT_MARGIN, anchor.above - height);
    setPosition({ left, top, origin: fitsBelow ? 'top left' : 'bottom left' });
  }, [anchor, page]);

  useEffect(() => {
    const menu = menuRef.current;
    const first =
      menu?.querySelector<HTMLElement>('[data-menu-focus]') ??
      menu?.querySelector<HTMLElement>('button:not(:disabled)');
    first?.focus();
  }, [page]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onViewportChange = () => onClose();
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('blur', onViewportChange);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('blur', onViewportChange);
    };
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu || onKey?.(event)) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      moveFocus(menu, event.key);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab') {
      onClose();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className={className ? `ctx ${className}` : 'ctx'}
      role="menu"
      aria-label={label}
      style={{ left: position.left, top: position.top, transformOrigin: position.origin }}
      onKeyDown={onKeyDown}
    >
      <div key={page} className={page === 'main' ? 'ctx-page' : 'ctx-page in'}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

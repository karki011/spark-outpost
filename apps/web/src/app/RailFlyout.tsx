import {
  Fragment,
  useEffect,
  useId,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { usePopover } from '../ui/use-popover.ts';
import './rail-flyout.css';

export interface FlyoutItem {
  id: string;
  label: string;
  icon: ReactNode;
  current?: boolean;
  shortcut?: string | undefined;
  disabled?: boolean;
  onSelect: () => void;
}

interface RailFlyoutProps {
  groups: readonly (readonly FlyoutItem[])[];
  dot: string | null;
  onIntent: () => void;
}

const MORE_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.9" />
    <circle cx="12" cy="12" r="1.9" />
    <circle cx="19" cy="12" r="1.9" />
  </svg>
);

const GAP = 8;

function menuItems(panel: HTMLElement | null): HTMLButtonElement[] {
  return [
    ...(panel?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []),
  ];
}

export function RailFlyout({ groups, dot, onIntent }: RailFlyoutProps) {
  const menuId = useId();
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const [place, setPlace] = useState({ left: 0, bottom: 0 });
  const current = groups.flat().find((item) => item.current);

  useEffect(() => {
    if (open) menuItems(panelRef.current)[0]?.focus();
  }, [open, panelRef]);

  const onToggle = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setPlace({ left: box.right + GAP, bottom: window.innerHeight - box.bottom });
    toggle();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(panelRef.current);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: items.length - 1,
    };
    const target = next[event.key];
    if (target === undefined || items.length === 0) return;
    event.preventDefault();
    items[(target + items.length) % items.length]?.focus();
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={current || open ? 'rail-btn on' : 'rail-btn'}
        data-view={current?.id}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={[current ? `More, showing ${current.label}` : 'More', dot]
          .filter(Boolean)
          .join(', ')}
        onPointerEnter={onIntent}
        onFocus={onIntent}
        onClick={onToggle}
      >
        {MORE_ICON}
        More
        {dot && <i className="rdot warn" aria-hidden="true" />}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={menuId}
          className="rail-flyout"
          role="menu"
          aria-label="More"
          style={place}
          onKeyDown={onKeyDown}
        >
          {groups.map((group, index) => (
            <Fragment key={group[0]?.id ?? index}>
              {index > 0 && <div className="rail-flyout-sep" role="separator" />}
              {group.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  data-view={item.id}
                  aria-current={item.current ? 'page' : undefined}
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.icon}
                  <span className="rail-flyout-label">{item.label}</span>
                  {item.shortcut && (
                    <kbd className="rail-flyout-keys" aria-hidden="true">
                      {item.shortcut}
                    </kbd>
                  )}
                </button>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}

import { useEffect, useId, type ReactNode } from 'react';
import { usePopover } from '../ui/use-popover.ts';

interface MoreItem {
  id: string;
  label: string;
  icon: ReactNode;
  current: boolean;
  onSelect: () => void;
}

const MORE_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.9" />
    <circle cx="12" cy="12" r="1.9" />
    <circle cx="19" cy="12" r="1.9" />
  </svg>
);

export function RailMore({ items }: { items: MoreItem[] }) {
  const panelId = useId();
  const { open, setOpen, toggle, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const active = items.find((item) => item.current);

  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [open, panelRef]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={active ? 'rail-btn on' : 'rail-btn'}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={active ? `More, showing ${active.label}` : 'More'}
        onClick={toggle}
      >
        {MORE_ICON}
        More
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className="rail-more"
          role="group"
          aria-label="More destinations"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-view={item.id}
              aria-current={item.current ? 'page' : undefined}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

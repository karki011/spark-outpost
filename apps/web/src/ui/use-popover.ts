import { useEffect, useRef, useState } from 'react';

export function usePopover<Anchor extends HTMLElement, Panel extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<Anchor>(null);
  const panelRef = useRef<Panel>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      anchorRef.current?.focus();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return {
    open,
    setOpen,
    toggle: () => setOpen((value) => !value),
    anchorRef,
    panelRef,
  };
}

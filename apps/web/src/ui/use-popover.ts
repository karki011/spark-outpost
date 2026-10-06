import { useEffect, useRef, useState } from 'react';
import { useKeepInViewport } from './viewport-clamp.ts';

export function usePopover<Anchor extends HTMLElement, Panel extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<Anchor>(null);
  const panelRef = useRef<Panel>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useKeepInViewport(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
      (returnFocusRef.current ?? anchorRef.current)?.focus();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return {
    open,
    setOpen,
    toggle: () => setOpen((value) => !value),
    anchorRef,
    panelRef,
    returnFocusRef,
  };
}

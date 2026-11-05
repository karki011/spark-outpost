import { useRef, useState, type RefObject } from 'react';
import { useDismiss } from './use-dismiss.ts';
import { useKeepInViewport } from './viewport-clamp.ts';

export function usePopover<Anchor extends HTMLElement, Panel extends HTMLElement>(
  alsoInside?: RefObject<HTMLElement | null>,
) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<Anchor>(null);
  const panelRef = useRef<Panel>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useKeepInViewport(panelRef, open);
  useDismiss({
    open,
    panelRef,
    anchor: () => anchorRef.current,
    alsoInside: () => alsoInside?.current ?? null,
    focusBack: () => returnFocusRef.current ?? anchorRef.current,
    onClose: () => setOpen(false),
  });

  return {
    open,
    setOpen,
    toggle: () => setOpen((value) => !value),
    anchorRef,
    panelRef,
    returnFocusRef,
  };
}

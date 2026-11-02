import { useEffect, type RefObject } from 'react';
import { useStableCallback } from './use-stable-callback.ts';

interface DismissOptions {
  open: boolean;
  panelRef: RefObject<HTMLElement | null>;
  anchor: () => HTMLElement | null;
  alsoInside?: () => HTMLElement | null;
  focusBack: () => HTMLElement | null;
  onClose: () => void;
}

export function useDismiss({
  open,
  panelRef,
  anchor,
  alsoInside = () => null,
  focusBack,
  onClose,
}: DismissOptions) {
  const close = useStableCallback(onClose);
  const anchorOf = useStableCallback(anchor);
  const secondAnchor = useStableCallback(alsoInside);
  const focusTarget = useStableCallback(focusBack);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorOf()?.contains(target)) return;
      if (secondAnchor()?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      close();
      const target = focusTarget();
      if (target?.isConnected) target.focus();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, panelRef, anchorOf, secondAnchor, focusTarget, close]);
}

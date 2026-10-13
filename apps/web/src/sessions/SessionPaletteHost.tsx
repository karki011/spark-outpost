import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { isPaletteShortcut } from './palette-model.ts';
import { usePaletteRequests } from './palette-request.ts';

const SessionPalette = lazy(() =>
  import('./SessionPalette.tsx').then((module) => ({ default: module.SessionPalette })),
);

export function SessionPaletteHost({ onOpenChat }: { onOpenChat: (chatId: string) => void }) {
  const [open, setOpen] = useState(false);
  const returnTo = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    returnTo.current ??= document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    returnTo.current?.focus();
    returnTo.current = null;
  }, []);
  usePaletteRequests(show);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (open) close();
      else show();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, show, close]);

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <SessionPalette
        onOpenChat={(chatId) => {
          setOpen(false);
          returnTo.current = null;
          onOpenChat(chatId);
        }}
        onClose={close}
      />
    </Suspense>
  );
}

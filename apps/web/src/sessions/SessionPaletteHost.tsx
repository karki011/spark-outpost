import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { requestMessageJump } from '../chat/message-jump.ts';
import { focusOpenedSession } from './focus-session.ts';
import { isPaletteShortcut } from './palette-model.ts';
import { usePaletteRequests } from './palette-request.ts';
import { isTerminalSession } from './session-line.ts';

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
        onOpenChat={(chat) => {
          setOpen(false);
          returnTo.current = null;
          const terminal = isTerminalSession(chat);
          if (chat.match && !terminal) requestMessageJump(chat.id, chat.match);
          onOpenChat(chat.id);
          focusOpenedSession(terminal);
        }}
        onClose={close}
      />
    </Suspense>
  );
}

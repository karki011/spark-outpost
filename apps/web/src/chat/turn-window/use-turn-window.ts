import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { onRevealTurns } from './reveal-turns.ts';
import {
  deferredTurns,
  nextIdleBatch,
  tailTurns,
  withMounted,
  type MountedTurns,
} from './turn-window.ts';

const NEAR_VIEWPORT = '100% 0px';
const IDLE_FALLBACK_MS = 50;

interface WindowState {
  chatId: string;
  mounted: MountedTurns;
}

interface TurnWindow {
  mounted: MountedTurns;
  reveal: (runIds: readonly string[]) => void;
}

function whenIdle(work: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(work);
    return () => window.cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(work, IDLE_FALLBACK_MS);
  return () => window.clearTimeout(timer);
}

export function useTurnWindow(
  chatId: string,
  ids: readonly string[],
  scroller: RefObject<HTMLElement | null>,
): TurnWindow {
  const [state, setState] = useState<WindowState>(() => ({
    chatId,
    mounted: new Set(tailTurns(ids)),
  }));
  let current = state;
  if (state.chatId !== chatId) {
    current = { chatId, mounted: new Set(tailTurns(ids)) };
  } else {
    const grown = withMounted(state.mounted, tailTurns(ids));
    if (grown !== state.mounted) current = { chatId, mounted: grown };
  }
  if (current !== state) setState(current);

  const latestIds = useRef(ids);
  useEffect(() => {
    latestIds.current = ids;
  });

  const reveal = useCallback(
    (runIds: readonly string[]) => {
      setState((before) => {
        if (before.chatId !== chatId) return before;
        const mounted = withMounted(before.mounted, runIds);
        return mounted === before.mounted ? before : { chatId, mounted };
      });
    },
    [chatId],
  );

  const mounted = current.mounted;
  const order = ids.join(' ');
  const waiting = deferredTurns(ids, mounted).length > 0;

  useEffect(() => {
    if (!waiting) return;
    return onRevealTurns(() => reveal(latestIds.current));
  }, [waiting, reveal]);

  useEffect(() => {
    const batch = nextIdleBatch(order === '' ? [] : order.split(' '), mounted);
    if (batch.length === 0) return;
    return whenIdle(() => reveal(batch));
  }, [order, mounted, reveal]);

  useEffect(() => {
    const root = scroller.current;
    if (!waiting || !root || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const near = entries.flatMap((entry) => {
          const id = entry.isIntersecting ? (entry.target as HTMLElement).dataset.turn : undefined;
          return id ? [id] : [];
        });
        if (near.length > 0) reveal(near);
      },
      { root, rootMargin: NEAR_VIEWPORT },
    );
    for (const shell of root.querySelectorAll('section[data-deferred]')) observer.observe(shell);
    return () => observer.disconnect();
  }, [waiting, order, scroller, reveal]);

  return { mounted, reveal };
}

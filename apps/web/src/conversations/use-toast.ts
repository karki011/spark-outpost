import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastSpec {
  text: string;
  undo?: () => void;
  onSettle?: () => void;
}

export interface ShownToast extends ToastSpec {
  id: number;
}

export function useToast() {
  const [toast, setToast] = useState<ShownToast | null>(null);
  const current = useRef<ShownToast | null>(null);
  const nextId = useRef(0);

  const replace = useCallback((next: ShownToast | null, settlePrevious: boolean) => {
    const previous = current.current;
    current.current = next;
    setToast(next);
    if (settlePrevious) previous?.onSettle?.();
  }, []);

  const show = useCallback(
    (spec: ToastSpec) => {
      nextId.current += 1;
      replace({ ...spec, id: nextId.current }, true);
    },
    [replace],
  );

  const dismiss = useCallback(() => replace(null, true), [replace]);

  const undo = useCallback(() => {
    const shown = current.current;
    replace(null, false);
    shown?.undo?.();
  }, [replace]);

  useEffect(() => {
    const flush = () => {
      current.current?.onSettle?.();
      current.current = null;
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  return { toast, show, dismiss, undo };
}

export type Toaster = ReturnType<typeof useToast>;

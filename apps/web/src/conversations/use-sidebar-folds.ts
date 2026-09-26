import { useCallback, useEffect, useState } from 'react';

const FOLDS_KEY = 'spark-outpost.sidebar.collapsed-projects';

function readFolds(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(FOLDS_KEY) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveFolds(folds: ReadonlySet<string>): void {
  try {
    localStorage.setItem(FOLDS_KEY, JSON.stringify([...folds]));
  } catch {
    return;
  }
}

export function useSidebarFolds() {
  const [folded, setFolded] = useState<ReadonlySet<string>>(readFolds);

  const setOpen = useCallback((key: string, open: boolean) => {
    setFolded((current) => {
      if (current.has(key) !== open) return current;
      const next = new Set(current);
      if (open) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => saveFolds(folded), [folded]);

  return {
    isOpen: (key: string) => !folded.has(key),
    toggle: (key: string) => setOpen(key, folded.has(key)),
    open: useCallback((key: string) => setOpen(key, true), [setOpen]),
  };
}

export type SidebarFolds = ReturnType<typeof useSidebarFolds>;

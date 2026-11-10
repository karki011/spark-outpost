import { useState } from 'react';

export function useReconciled<T>(value: T, reconcile: (kept: T, next: T) => T): T {
  const [kept, setKept] = useState(value);
  if (kept === value) return kept;
  const next = reconcile(kept, value);
  if (next !== kept) setKept(next);
  return next;
}

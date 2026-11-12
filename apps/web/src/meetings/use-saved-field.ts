import { useCallback, useEffect, useRef, useState } from 'react';

const SAVE_DELAY_MS = 700;

export function useSavedField(
  serverValue: string,
  save: (value: string) => Promise<unknown>,
  delay = SAVE_DELAY_MS,
) {
  const [draft, setDraft] = useState(serverValue);
  const [failed, setFailed] = useState(false);
  const unsaved = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    if (unsaved.current === null) setDraft(serverValue);
    else if (unsaved.current === serverValue) unsaved.current = null;
  }, [serverValue]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const value = unsaved.current;
    if (value === null) return;
    saveRef.current(value).then(
      () => {
        if (unsaved.current === value) unsaved.current = null;
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);

  const change = useCallback(
    (value: string) => {
      setDraft(value);
      unsaved.current = value;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [delay, flush],
  );

  useEffect(() => flush, [flush]);

  return { value: draft, change, flush, failed };
}

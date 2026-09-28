import { useEffect, useState } from 'react';

export type CopyState = 'idle' | 'copied' | 'failed';

const FEEDBACK_MS = 1600;

export function useCopyFeedback() {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timeout = setTimeout(() => setState('idle'), FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [state]);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => setState('copied'),
      () => setState('failed'),
    );
  };

  return { state, copy };
}

export function copyButtonText(state: CopyState): string {
  if (state === 'copied') return 'Copied';
  if (state === 'failed') return 'Copy failed';
  return 'Copy';
}

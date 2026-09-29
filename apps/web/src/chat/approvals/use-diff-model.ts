import { useEffect, useMemo, useState } from 'react';
import { buildDiff, splitLines, type DiffModel } from './diff-model.ts';

const MAIN_THREAD_MAX_LINES = 120;

interface Computed {
  oldText: string | null;
  newText: string;
  model: DiffModel;
}

function small(oldText: string | null, newText: string): boolean {
  return splitLines(oldText ?? '').length + splitLines(newText).length <= MAIN_THREAD_MAX_LINES;
}

export function useDiffModel(oldText: string | null, newText: string): DiffModel | null {
  const inline = useMemo(() => small(oldText, newText), [oldText, newText]);
  const direct = useMemo(
    () => (inline ? buildDiff(oldText, newText) : null),
    [inline, oldText, newText],
  );
  const [computed, setComputed] = useState<Computed | null>(null);
  useEffect(() => {
    if (inline) return;
    const worker = new Worker(new URL('./diff-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<DiffModel>) => {
      setComputed({ oldText, newText, model: event.data });
      worker.terminate();
    };
    worker.postMessage({ oldText, newText });
    return () => worker.terminate();
  }, [inline, oldText, newText]);
  if (direct) return direct;
  return computed && computed.oldText === oldText && computed.newText === newText
    ? computed.model
    : null;
}

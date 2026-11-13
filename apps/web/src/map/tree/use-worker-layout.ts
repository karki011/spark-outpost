import { useEffect, useMemo, useRef, useState } from 'react';

export interface WorkerLayout<Result> {
  result: Result;
  signature: string;
  fresh: boolean;
}

interface Reply<Result> {
  id: number;
  result: Result;
}

export function useWorkerLayout<Input, Result>(
  createWorker: () => Worker,
  input: Input,
  key: string,
): WorkerLayout<Result> | null {
  const [layout, setLayout] = useState<Omit<WorkerLayout<Result>, 'fresh'> | null>(null);
  const worker = useRef<Worker | null>(null);
  const asked = useRef({ id: 0, key: '' });

  useEffect(() => {
    const created = createWorker();
    created.onmessage = (event: MessageEvent<Reply<Result>>) => {
      if (event.data.id !== asked.current.id) return;
      setLayout({ result: event.data.result, signature: asked.current.key });
    };
    worker.current = created;
    return () => {
      created.terminate();
      worker.current = null;
      asked.current = { id: asked.current.id, key: '' };
    };
  }, [createWorker]);

  useEffect(() => {
    if (!worker.current || asked.current.key === key) return;
    asked.current = { id: asked.current.id + 1, key };
    worker.current.postMessage({ id: asked.current.id, input });
  }, [key, input]);

  return useMemo(
    () => (layout ? { ...layout, fresh: layout.signature === key } : null),
    [layout, key],
  );
}

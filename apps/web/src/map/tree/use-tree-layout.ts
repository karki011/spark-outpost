import { useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutInput, LayoutResult } from './tree-layout.ts';

function signature(input: LayoutInput): string {
  const nodes = input.nodes.map((n) => `${n.id}|${n.parent ?? ''}|${n.container ? 1 : 0}`);
  const edges = input.edges.map((e) => `${e.source}>${e.target}`);
  return `${input.columns ? 1 : 0}\n${nodes.join('\n')}\n${edges.join('\n')}`;
}

export interface TreeLayout {
  result: LayoutResult;
  signature: string;
  fresh: boolean;
}

interface Reply {
  id: number;
  result: LayoutResult;
}

export function useTreeLayout(input: LayoutInput): TreeLayout | null {
  const key = useMemo(() => signature(input), [input]);
  const [layout, setLayout] = useState<Omit<TreeLayout, 'fresh'> | null>(null);
  const worker = useRef<Worker | null>(null);
  const asked = useRef({ id: 0, key: '' });

  useEffect(() => {
    const created = new Worker(new URL('./tree-layout-worker.ts', import.meta.url), {
      type: 'module',
    });
    created.onmessage = (event: MessageEvent<Reply>) => {
      if (event.data.id !== asked.current.id) return;
      setLayout({ result: event.data.result, signature: asked.current.key });
    };
    worker.current = created;
    return () => {
      created.terminate();
      worker.current = null;
      asked.current = { id: asked.current.id, key: '' };
    };
  }, []);

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

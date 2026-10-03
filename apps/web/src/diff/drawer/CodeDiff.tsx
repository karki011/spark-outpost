import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeDiff } from '@spark-outpost/contracts';
import {
  createCodeDiff,
  type CodeDiffInput,
  type CodeDiffView,
  type DiffMode,
} from './code-view.ts';

interface CodeDiffProps {
  diff: ChangeDiff;
  mode: DiffMode;
  wrap: boolean;
}

export function CodeDiff({ diff, mode, wrap }: CodeDiffProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<CodeDiffView | null>(null);
  const [generation, setGeneration] = useState(0);
  const { path, change, oldText, newText } = diff;
  const input = useRef<CodeDiffInput | null>(null);

  useLayoutEffect(() => {
    input.current = { path, change, oldText, newText: newText ?? '', mode, wrap: false };
  }, [path, change, oldText, newText, mode]);

  useEffect(() => {
    const parent = host.current;
    if (!parent || !input.current) return;
    const created = createCodeDiff(parent, input.current);
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
  }, [path, mode, generation]);

  useEffect(() => {
    const current = view.current;
    if (!current || !input.current) return;
    if (!current.update(input.current)) setGeneration((count) => count + 1);
  }, [change, oldText, newText]);

  useEffect(() => {
    view.current?.setWrap(wrap);
  }, [wrap, path, mode, generation]);

  return <div ref={host} className={`dd-code ${mode}`} />;
}

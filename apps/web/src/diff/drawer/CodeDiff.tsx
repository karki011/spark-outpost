import { useEffect, useRef } from 'react';
import type { ChangeDiff } from '@spark-outpost/contracts';
import { createCodeDiff, type CodeDiffView, type DiffMode } from './code-view.ts';

interface CodeDiffProps {
  diff: ChangeDiff;
  mode: DiffMode;
  wrap: boolean;
}

export function CodeDiff({ diff, mode, wrap }: CodeDiffProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<CodeDiffView | null>(null);
  const { path, change, oldText, newText } = diff;

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const created = createCodeDiff(parent, {
      path,
      change,
      oldText,
      newText: newText ?? '',
      mode,
      wrap: false,
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
  }, [path, change, oldText, newText, mode]);

  useEffect(() => {
    view.current?.setWrap(wrap);
  }, [wrap, path, change, oldText, newText, mode]);

  return <div ref={host} className={`dd-code ${mode}`} />;
}

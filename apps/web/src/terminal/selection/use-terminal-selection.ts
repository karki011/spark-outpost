import { useCallback, useMemo, useRef, useState } from 'react';
import type { SelectionActions, SelectionHandler, TerminalSelection } from './follow-selection.ts';

export interface SelectionTarget extends SelectionActions {
  focus(): void;
}

export interface TerminalSelectionState {
  selection: TerminalSelection | null;
  copied: boolean;
  commenting: boolean;
  report: SelectionHandler;
  attach(target: SelectionTarget | null): void;
  target(): SelectionTarget | null;
  copy(): void;
  comment(open: boolean): void;
  dismiss(): void;
}

export function useTerminalSelection(): TerminalSelectionState {
  const [selection, setSelection] = useState<TerminalSelection | null>(null);
  const [copiedFor, setCopiedFor] = useState<TerminalSelection | null>(null);
  const [commentFor, setCommentFor] = useState<TerminalSelection | null>(null);
  const targetRef = useRef<SelectionTarget | null>(null);
  const noteOpen = useRef(false);

  const write = useCallback((selected: TerminalSelection) => {
    void navigator.clipboard?.writeText(selected.text).then(
      () => setCopiedFor(selected),
      () => undefined,
    );
  }, []);
  const report = useCallback<SelectionHandler>(
    (next, cause) => {
      if (!next && cause === 'scroll' && noteOpen.current) return;
      noteOpen.current = false;
      setCommentFor(null);
      setSelection(next);
      if (next) write(next);
    },
    [write],
  );
  const attach = useCallback((target: SelectionTarget | null) => {
    targetRef.current = target;
    if (target) return;
    noteOpen.current = false;
    setSelection(null);
  }, []);
  const target = useCallback(() => targetRef.current, []);
  const comment = useCallback(
    (open: boolean) => {
      noteOpen.current = open && selection !== null;
      setCommentFor(open ? selection : null);
    },
    [selection],
  );
  const copy = useCallback(() => {
    if (selection) write(selection);
  }, [selection, write]);
  const dismiss = useCallback(() => {
    noteOpen.current = false;
    setCommentFor(null);
    setSelection(null);
  }, []);

  return useMemo(
    () => ({
      selection,
      copied: selection !== null && copiedFor === selection,
      commenting: selection !== null && commentFor === selection,
      report,
      attach,
      target,
      copy,
      comment,
      dismiss,
    }),
    [selection, copiedFor, commentFor, report, attach, target, copy, comment, dismiss],
  );
}

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { normalizeQuote } from './quote-text.ts';
import { clampToMessage, isSameRange } from './selection.ts';

export interface CapturedSelection {
  range: Range;
  text: string;
  source: Element;
}

export function readMessageSelection(root: Element): CapturedSelection | null {
  const selection = window.getSelection();
  if (!selection) return null;
  const clamped = clampToMessage(selection, root);
  if (!clamped) return null;
  if (!isSameRange(clamped.range, selection.getRangeAt(0))) {
    selection.removeAllRanges();
    selection.addRange(clamped.range);
  }
  const text = normalizeQuote(selection.toString());
  return text ? { range: clamped.range.cloneRange(), text, source: clamped.source } : null;
}

interface CaptureOptions {
  scrollerRef: RefObject<HTMLElement | null>;
  toolbarRef: RefObject<HTMLElement | null>;
  locked: boolean;
}

export function useSelectionCapture({ scrollerRef, toolbarRef, locked }: CaptureOptions) {
  const [captured, setCaptured] = useState<CapturedSelection | null>(null);
  const pointerDown = useRef(false);
  const lockedRef = useRef(locked);

  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  const dismiss = useCallback(() => setCaptured(null), []);

  useEffect(() => {
    let frame = 0;
    const evaluate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = scrollerRef.current;
        if (lockedRef.current || pointerDown.current || !root) return;
        const next = readMessageSelection(root);
        if (next) {
          setCaptured((current) =>
            current && current.text === next.text && isSameRange(current.range, next.range)
              ? current
              : next,
          );
          return;
        }
        if (toolbarRef.current?.contains(document.activeElement)) return;
        setCaptured(null);
      });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (toolbarRef.current?.contains(event.target as Node)) return;
      pointerDown.current = true;
      if (lockedRef.current) setCaptured(null);
    };
    const onPointerUp = () => {
      if (!pointerDown.current) return;
      pointerDown.current = false;
      evaluate();
    };
    document.addEventListener('selectionchange', evaluate);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', evaluate);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
    };
  }, [scrollerRef, toolbarRef]);

  return { captured, dismiss };
}

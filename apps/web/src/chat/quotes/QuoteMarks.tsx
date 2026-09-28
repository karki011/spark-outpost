import './quotes.css';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TextAnchor } from '@spark-outpost/contracts';
import { api, queryKeys } from '../../api/client.ts';
import { resolveAnchor } from './anchor.ts';
import { paintHighlight } from './highlight.ts';
import { sourcesFor, userMessageElement } from './selection.ts';
import type { Quote } from './use-quotes.ts';

const SENT_HIGHLIGHT = 'spark-annotation';
const UNSENT_HIGHLIGHT = 'spark-quote-note';
const FLASH_MS = 1800;
const TIP_WIDTH = 260;

interface Anchored {
  id: string;
  note: string;
  sourceMessageId: string;
  anchor: TextAnchor;
  messageId: string | null;
}

interface Mark {
  id: string;
  note: string;
  messageId: string | null;
  range: Range;
}

interface Tip {
  id: string;
  note: string;
  left: number;
  top: number;
}

interface QuoteMarksProps {
  scrollerRef: RefObject<HTMLDivElement | null>;
  conversationId: string;
  pending: readonly Quote[];
}

function resolveMarks(root: Element, anchored: readonly Anchored[]): Mark[] {
  return anchored.flatMap((item) => {
    const range = resolveAnchor(sourcesFor(root, item.sourceMessageId), item.anchor);
    return range ? [{ id: item.id, note: item.note, messageId: item.messageId, range }] : [];
  });
}

function hitMark(
  marks: readonly Mark[],
  x: number,
  y: number,
): { mark: Mark; rect: DOMRect } | null {
  for (const mark of marks) {
    for (const rect of Array.from(mark.range.getClientRects())) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return { mark, rect };
      }
    }
  }
  return null;
}

function flashMessage(root: Element, messageId: string) {
  const bubble = userMessageElement(root, messageId)?.querySelector('.bubble');
  if (!bubble) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  bubble.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  const accent = getComputedStyle(bubble).getPropertyValue('--accent').trim();
  bubble.animate([{ boxShadow: `0 0 0 3px ${accent}` }, { boxShadow: `0 0 0 3px transparent` }], {
    duration: reduced ? 0 : FLASH_MS,
    easing: 'ease-out',
  });
}

export function QuoteMarks({ scrollerRef, conversationId, pending }: QuoteMarksProps) {
  const annotations = useQuery({
    queryKey: queryKeys.annotations(conversationId),
    queryFn: () => api.listAnnotations(conversationId),
  });
  const marksRef = useRef<Mark[]>([]);
  const [tip, setTip] = useState<Tip | null>(null);

  const sent = useMemo<Anchored[]>(
    () => (annotations.data ?? []).filter((annotation) => annotation.kind === 'comment'),
    [annotations.data],
  );
  const unsent = useMemo<Anchored[]>(
    () =>
      pending.flatMap((quote) =>
        quote.kind === 'comment' && quote.messageId && quote.anchor
          ? [
              {
                id: quote.id,
                note: quote.note,
                sourceMessageId: quote.messageId,
                anchor: quote.anchor,
                messageId: null,
              },
            ]
          : [],
      ),
    [pending],
  );

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    let frame = 0;
    let clearSent: () => void = () => undefined;
    let clearUnsent: () => void = () => undefined;
    const paint = () => {
      const sentMarks = resolveMarks(root, sent);
      marksRef.current = sentMarks;
      clearSent();
      clearUnsent();
      clearSent = paintHighlight(
        SENT_HIGHLIGHT,
        sentMarks.map((mark) => mark.range),
      );
      clearUnsent = paintHighlight(
        UNSENT_HIGHLIGHT,
        resolveMarks(root, unsent).map((mark) => mark.range),
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    };
    paint();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearSent();
      clearUnsent();
      marksRef.current = [];
    };
  }, [scrollerRef, sent, unsent]);

  useEffect(() => {
    const root = scrollerRef.current;
    const wrap = root?.parentElement;
    if (!root || !wrap) return;
    let frame = 0;
    const onPointerMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const hit = hitMark(marksRef.current, event.clientX, event.clientY);
        root.toggleAttribute('data-mark-hover', hit !== null);
        if (!hit) return setTip(null);
        const origin = wrap.getBoundingClientRect();
        const left = Math.min(
          Math.max(8, hit.rect.left - origin.left),
          Math.max(8, origin.width - TIP_WIDTH - 8),
        );
        const top = hit.rect.bottom - origin.top + 6;
        setTip((current) =>
          current?.id === hit.mark.id
            ? current
            : { id: hit.mark.id, note: hit.mark.note, left, top },
        );
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(frame);
      root.removeAttribute('data-mark-hover');
      setTip(null);
    };
    const onClick = (event: MouseEvent) => {
      if (!window.getSelection()?.isCollapsed) return;
      const hit = hitMark(marksRef.current, event.clientX, event.clientY);
      if (hit?.mark.messageId) flashMessage(root, hit.mark.messageId);
    };
    const onScroll = () => setTip(null);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('click', onClick);
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('click', onClick);
      root.removeEventListener('scroll', onScroll);
    };
  }, [scrollerRef]);

  if (!tip) return null;
  return (
    <div className="mark-tip" role="tooltip" style={{ left: tip.left, top: tip.top }}>
      <span className="mark-tip-note">{tip.note}</span>
      <span className="mark-tip-hint">Click to see your message</span>
    </div>
  );
}

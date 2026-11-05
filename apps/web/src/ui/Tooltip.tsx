import './tooltip.css';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Keys, type ShortcutKeys } from './Keys.tsx';

const SHOW_DELAY_MS = 400;
const GAP = 6;
const EDGE = 8;

export type TooltipSide = 'top' | 'bottom';

export interface TipItem {
  label: string;
  text: string;
}

export interface RichTip {
  lead?: string;
  items: readonly TipItem[];
  footer?: string;
}

export type TipContent = string | RichTip;

export function tipText(content: TipContent): string {
  if (typeof content === 'string') return content;
  const items = content.items.map((item) => `${item.label}: ${item.text}`);
  return [content.lead, ...items, content.footer].filter(Boolean).join(' ');
}

function TipBody({ content }: { content: RichTip }) {
  return (
    <>
      {content.lead && <p className="tip-lead">{content.lead}</p>}
      <ul className="tip-list">
        {content.items.map((item) => (
          <li key={item.label}>
            <b>{item.label}</b> {item.text}
          </li>
        ))}
      </ul>
      {content.footer && <p className="tip-foot">{content.footer}</p>}
    </>
  );
}

interface TooltipOptions {
  side?: TooltipSide;
  keys?: ShortcutKeys;
}

interface BubbleProps {
  id: string;
  label: TipContent;
  keys: ShortcutKeys | undefined;
  anchor: DOMRect;
  side: TooltipSide;
}

function TooltipBubble({ id, label, keys, anchor, side }: BubbleProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bubble = ref.current;
    if (!bubble) return;
    const rect = bubble.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    const centered = anchor.left + anchor.width / 2 - width / 2;
    const left = Math.min(Math.max(EDGE, centered), innerWidth - width - EDGE);
    const x = Math.max(EDGE, Math.floor(left));
    const below = anchor.bottom + GAP;
    const above = anchor.top - height - GAP;
    const fitsBelow = below + height <= innerHeight - EDGE;
    const top = side === 'bottom' ? (fitsBelow ? below : above) : above >= EDGE ? above : below;
    bubble.style.left = `${x}px`;
    bubble.style.top = `${Math.round(top)}px`;
    bubble.dataset.placed = top === below ? 'below' : 'above';
  }, [anchor, side, label]);
  const rich = typeof label !== 'string';
  return (
    <div ref={ref} id={id} role="tooltip" className={rich ? 'tooltip tip-rich' : 'tooltip'}>
      {rich ? <TipBody content={label} /> : label}
      {keys && <Keys keys={keys} />}
    </div>
  );
}

export function useTooltip(label: TipContent, { side = 'bottom', keys }: TooltipOptions = {}) {
  const id = useId();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorElement = useRef<HTMLElement | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const hide = useCallback(() => {
    cancel();
    setAnchor(null);
  }, [cancel]);

  const showSoon = useCallback(
    (element: HTMLElement) => {
      cancel();
      anchorElement.current = element;
      timer.current = setTimeout(() => setAnchor(element.getBoundingClientRect()), SHOW_DELAY_MS);
    },
    [cancel],
  );

  const show = useCallback(
    (element: HTMLElement) => {
      cancel();
      anchorElement.current = element;
      setAnchor(element.getBoundingClientRect());
    },
    [cancel],
  );

  useEffect(() => cancel, [cancel]);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      hide();
    };
    const onScroll = (event: Event) => {
      const scrolled = event.target;
      const moved = !(scrolled instanceof Node) || scrolled.contains(anchorElement.current);
      if (moved) hide();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', hide);
    };
  }, [anchor, hide]);

  const triggerProps = {
    'aria-describedby': anchor ? id : undefined,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse') showSoon(event.currentTarget);
    },
    onPointerLeave: hide,
    onPointerDown: hide,
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).matches(':focus-visible')) showSoon(event.currentTarget);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hide();
    },
  };

  const tooltip = anchor
    ? createPortal(
        <TooltipBubble id={id} label={label} keys={keys} anchor={anchor} side={side} />,
        document.body,
      )
    : null;

  return { triggerProps, tooltip, show };
}

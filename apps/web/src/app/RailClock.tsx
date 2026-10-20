import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTooltip } from '../ui/Tooltip.tsx';
import { hourCycle } from '../desktop/hour-cycle.ts';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { clockLabel, clockParts, clockTitle, type ClockPart } from './rail-clock-format.ts';
import './rail-clock.css';

interface RailClockProps {
  onOpen: (() => void) | undefined;
  onIntent: () => void;
}

function FlipDigits({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  const [changed, setChanged] = useState(false);
  if (text !== shown) {
    setShown(text);
    setChanged(true);
  }
  return (
    <span key={text} className={changed ? 'rail-clock-digits flip' : 'rail-clock-digits'}>
      {text}
    </span>
  );
}

const FULL_SIZE_PX = 12;
const SMALLEST_SIZE_PX = 8;

function shrinkToFit(element: HTMLElement) {
  if (element.clientWidth === 0) return;
  let size = FULL_SIZE_PX;
  element.style.fontSize = '';
  while (element.scrollWidth > element.clientWidth && size > SMALLEST_SIZE_PX) {
    size -= 0.5;
    element.style.fontSize = `${size}px`;
  }
}

function useShrinkToFit(text: string) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element) shrinkToFit(element);
  }, [text]);
  useEffect(() => {
    const element = ref.current;
    const rail = element?.closest('nav') ?? element?.parentElement;
    if (!element || !rail || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => shrinkToFit(element));
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);
  return ref;
}

function ClockPartView({ part }: { part: ClockPart }) {
  if (part.kind === 'hour' || part.kind === 'minute') return <FlipDigits text={part.text} />;
  if (part.kind === 'period') return <span className="rail-clock-period">{part.text}</span>;
  return <span>{part.text}</span>;
}

function ClockFace({ parts, decorative }: { parts: ClockPart[]; decorative: boolean }) {
  const ref = useShrinkToFit(parts.map((part) => part.text).join(''));
  return (
    <span ref={ref} className="rail-clock-face" aria-hidden={decorative || undefined}>
      {parts.map((part, index) => (
        <ClockPartView key={part.kind === 'literal' ? index : part.kind} part={part} />
      ))}
    </span>
  );
}

export function RailClock({ onOpen, onIntent }: RailClockProps) {
  const now = new Date(useMinuteClock());
  const cycle = hourCycle();
  const { triggerProps, tooltip } = useTooltip(clockTitle(now, undefined, cycle), { side: 'top' });
  const parts = clockParts(now, undefined, cycle);
  if (!onOpen) {
    return (
      <time className="rail-clock" dateTime={now.toISOString()}>
        <ClockFace parts={parts} decorative={false} />
      </time>
    );
  }
  return (
    <>
      <button
        type="button"
        className="rail-clock"
        aria-label={`${clockLabel(now, undefined, cycle)}. Open Today`}
        {...triggerProps}
        onPointerEnter={(event) => {
          triggerProps.onPointerEnter(event);
          onIntent();
        }}
        onFocus={(event) => {
          triggerProps.onFocus(event);
          onIntent();
        }}
        onClick={onOpen}
      >
        <ClockFace parts={parts} decorative />
      </button>
      {tooltip}
    </>
  );
}

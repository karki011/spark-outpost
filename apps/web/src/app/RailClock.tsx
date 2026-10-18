import { useState } from 'react';
import { useTooltip } from '../ui/Tooltip.tsx';
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

function ClockFace({ parts }: { parts: ClockPart[] }) {
  return parts.map((part, index) => {
    if (part.kind === 'hour' || part.kind === 'minute') {
      return <FlipDigits key={part.kind} text={part.text} />;
    }
    if (part.kind === 'period') {
      return (
        <span key={index} className="rail-clock-period">
          {part.text}
        </span>
      );
    }
    return <span key={index}>{part.text}</span>;
  });
}

export function RailClock({ onOpen, onIntent }: RailClockProps) {
  const now = new Date(useMinuteClock());
  const { triggerProps, tooltip } = useTooltip(clockTitle(now), { side: 'top' });
  const face = <ClockFace parts={clockParts(now)} />;
  if (!onOpen) {
    return (
      <time className="rail-clock" dateTime={now.toISOString()}>
        {face}
      </time>
    );
  }
  return (
    <>
      <button
        type="button"
        className="rail-clock"
        aria-label={`${clockLabel(now)}. Open Today`}
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
        <span aria-hidden="true">{face}</span>
      </button>
      {tooltip}
    </>
  );
}

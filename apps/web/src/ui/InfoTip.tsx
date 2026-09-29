import './info-tip.css';
import { useId } from 'react';
import { InfoIcon } from './icons.tsx';
import { useTooltip } from './Tooltip.tsx';

interface InfoTipProps {
  topic: string;
  text: string;
}

export function InfoTip({ topic, text }: InfoTipProps) {
  const textId = useId();
  const { triggerProps, tooltip, show } = useTooltip(text, { side: 'top' });
  return (
    <>
      <button
        type="button"
        className="info-tip"
        aria-label={`More about ${topic}`}
        {...triggerProps}
        aria-describedby={textId}
        onClick={(event) => show(event.currentTarget)}
      >
        <InfoIcon />
      </button>
      <span id={textId} hidden>
        {text}
      </span>
      {tooltip}
    </>
  );
}

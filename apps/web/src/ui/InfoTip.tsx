import './info-tip.css';
import { useId } from 'react';
import { DocLink, type DocTarget } from './DocLink.tsx';
import { InfoIcon } from './icons.tsx';
import { tipText, useTooltip, type TipContent } from './Tooltip.tsx';

interface InfoTipProps {
  topic: string;
  text: TipContent;
  doc?: DocTarget | undefined;
}

export function InfoTip({ topic, text, doc }: InfoTipProps) {
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
        {tipText(text)}
      </span>
      {tooltip}
      {doc && <DocLink topic={topic} doc={doc} />}
    </>
  );
}

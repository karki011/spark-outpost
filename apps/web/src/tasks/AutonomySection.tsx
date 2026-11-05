import './autonomy-section.css';
import { useEffect, useId, useRef, useState } from 'react';
import { AUTONOMY_LEVELS, autonomyLabel, type InvolvementLevel } from '@spark-outpost/contracts';
import { useChatSettingsUpdate } from '../chat/composer/use-picker-command.ts';
import { ChevronIcon } from '../ui/icons.tsx';
import { RadioRow } from '../ui/RadioRow.tsx';

interface AutonomySectionProps {
  conversationId: string;
  level: InvolvementLevel;
  initiallyOpen: boolean;
  focusRequest: number;
}

export function AutonomySection({
  conversationId,
  level,
  initiallyOpen,
  focusRequest,
}: AutonomySectionProps) {
  const prefix = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(initiallyOpen);
  const [handledRequest, setHandledRequest] = useState(focusRequest);
  const mountedRequest = useRef(focusRequest);
  const update = useChatSettingsUpdate(conversationId);

  if (focusRequest !== handledRequest) {
    setHandledRequest(focusRequest);
    setExpanded(true);
  }

  useEffect(() => {
    if (focusRequest === mountedRequest.current) return;
    const frame = requestAnimationFrame(() => {
      const section = sectionRef.current;
      section?.scrollIntoView({ block: 'nearest' });
      section?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  return (
    <section ref={sectionRef} className="wauto" aria-labelledby={`${prefix}-t`}>
      <h3 className="wauto-h">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`${prefix}-body`}
          onClick={() => setExpanded(!expanded)}
        >
          <span id={`${prefix}-t`}>Spark autonomy</span>
          <span className="wauto-now">{autonomyLabel(level)}</span>
          <ChevronIcon />
        </button>
      </h3>
      <div id={`${prefix}-body`} className="wauto-body" hidden={!expanded}>
        <div className="rlist" role="radiogroup" aria-labelledby={`${prefix}-t`}>
          {AUTONOMY_LEVELS.map((info) => (
            <RadioRow
              key={info.id}
              id={`${prefix}-l-${info.id}`}
              label={info.label}
              hint={info.hint}
              checked={info.id === level}
              onSelect={() => update.mutate({ level: info.id })}
            />
          ))}
        </div>
        {update.isError && (
          <p className="wnote bad" role="alert">
            {update.error.message}
          </p>
        )}
        <p className="wnote">Applies to this chat. New chats start with your defaults.</p>
      </div>
    </section>
  );
}

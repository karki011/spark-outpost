import './worth-a-look.css';
import { useId } from 'react';
import type { CheckpointPayload } from '@spark-outpost/contracts';
import { outsidePlanLabel, worthALook } from './worth-a-look.ts';

function InlineCode({ text }: { text: string }) {
  return (
    <>
      {text
        .split('`')
        .map((part, index) =>
          index % 2 === 1 ? <code key={index}>{part}</code> : <span key={index}>{part}</span>,
        )}
    </>
  );
}

interface WorthALookProps {
  payload: Pick<CheckpointPayload, 'laws' | 'outsidePlan'>;
  pending?: boolean;
}

export function WorthALook({ payload, pending = false }: WorthALookProps) {
  const headingId = useId();
  const { items, outsidePlan } = worthALook(payload);
  if (items.length === 0 && outsidePlan.length === 0) return null;
  return (
    <div className={pending ? 'wal pending' : 'wal'}>
      <p id={headingId} className="wal-h">
        {pending ? 'Worth a look before you keep this' : 'Worth a look'}
      </p>
      <ul aria-labelledby={headingId}>
        {items.map((item) => (
          <li key={item}>
            <InlineCode text={item} />
          </li>
        ))}
        {outsidePlan.length > 0 && (
          <li className="wal-fold">
            <details className="wal-outside">
              <summary>{outsidePlanLabel(outsidePlan.length)}</summary>
              <ul aria-label="Files outside the plan">
                {outsidePlan.map((file) => (
                  <li key={file}>
                    <code>{file}</code>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        )}
      </ul>
    </div>
  );
}

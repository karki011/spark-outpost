import '../../usage/usage.css';
import { useId } from 'react';
import type { AdviceSummary, Category, Orchestration } from '@spark-outpost/contracts';
import { CategoryChip } from '../../categories/CategoryChip.tsx';
import { dispatchParts } from '../../crew/crew-projection.ts';
import { adviceDetails } from '../AdviceLine.tsx';

const ROUTING = { auto: 'models by Jev', pinned: 'pinned model' } as const;

interface DispatchLineProps {
  orchestration: Orchestration;
  advice: AdviceSummary | undefined;
  category?: Category | null | undefined;
}

export function DispatchLine({ orchestration, advice, category }: DispatchLineProps) {
  const tipId = useId();
  const [lead, ...rest] = dispatchParts(orchestration, advice);
  const confidence = advice?.jev?.confidence;
  const source = orchestration.depthSource === 'jev' ? 'Jev' : 'Fixed rules';
  const tail = [
    ...rest,
    ROUTING[orchestration.routing],
    confidence === undefined ? null : confidence.toFixed(2),
  ].filter(Boolean);
  const details = advice
    ? adviceDetails(advice).filter((line) => !line.startsWith('Recorded only'))
    : [];
  return (
    <p className="jevline">
      <span
        className={details.length > 0 ? 'run-usage' : undefined}
        tabIndex={details.length > 0 ? 0 : undefined}
        aria-describedby={details.length > 0 ? tipId : undefined}
      >
        {source}: <b>{lead}</b>
        {tail.length > 0 && ` · ${tail.join(' · ')}`}
        {details.length > 0 && (
          <span className="usage-tip" role="tooltip" id={tipId}>
            {details.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        )}
      </span>{' '}
      <CategoryChip category={category} />
    </p>
  );
}

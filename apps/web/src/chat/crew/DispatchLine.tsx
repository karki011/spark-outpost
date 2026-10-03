import '../../usage/usage.css';
import { useId } from 'react';
import type { AdviceSummary, Category, Orchestration } from '@spark-outpost/contracts';
import { CategoryChip } from '../../categories/CategoryChip.tsx';
import { dispatchParts } from '../../crew/crew-projection.ts';
import { whyLines } from '../../crew/why-lines.ts';
import { adviceDetails } from '../AdviceChip.tsx';

const ROUTING = { auto: 'model by rules', pinned: 'pinned model' } as const;

const PLAN: Record<Orchestration['depth'], string> = {
  direct: 'Answer directly',
  execute: 'Build it',
  plan_execute: 'Plan, then build',
  plan_execute_review: 'Plan, build, then review',
};

interface DispatchLineProps {
  orchestration: Orchestration;
  advice: AdviceSummary | undefined;
  category?: Category | null | undefined;
}

export function DispatchLine({ orchestration, advice, category }: DispatchLineProps) {
  const tipId = useId();
  const parts = dispatchParts(orchestration, advice);
  const size = parts.length > 1 ? parts[0] : null;
  const confidence = advice?.jev?.confidence;
  const summary = [
    PLAN[orchestration.depth],
    size,
    confidence === undefined ? null : `${Math.round(confidence * 100)}% sure`,
    orchestration.depthSource === 'jev' ? null : 'by rules',
  ].filter(Boolean);
  const details = [
    `Model: ${ROUTING[orchestration.routing]}`,
    ...(advice ? adviceDetails(advice, { recordedRoute: false }) : []),
    ...whyLines(orchestration),
  ];
  return (
    <p className="jevline">
      <span className="run-usage" tabIndex={0} aria-describedby={tipId}>
        {summary.join(' · ')}
        <span className="usage-tip" role="tooltip" id={tipId}>
          {details.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      </span>
      {category && (
        <>
          {' · '}
          <CategoryChip category={category} />
        </>
      )}
    </p>
  );
}

import './save-plan.css';
import { createContext, useContext } from 'react';
import { planSavedText, type ConversationDetail } from '@spark-outpost/contracts';
import { CheckIcon } from '../../ui/icons.tsx';

export const OpenPlanContext = createContext<(() => void) | null>(null);

interface PlanSavedLineProps {
  detail: ConversationDetail;
  runId: string;
}

export function PlanSavedLine({ detail, runId }: PlanSavedLineProps) {
  const openPlan = useContext(OpenPlanContext);
  const line = detail.plans?.lines.find((candidate) => candidate.runId === runId);
  if (!line) return null;
  const text = planSavedText(line);
  return (
    <p className="saveplan saved plan-line">
      <CheckIcon />
      {openPlan ? (
        <button
          type="button"
          className="plan-line-open"
          aria-label={`${text}. Open the plan`}
          onClick={openPlan}
        >
          {text}
        </button>
      ) : (
        text
      )}
    </p>
  );
}

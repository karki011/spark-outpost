import { ANSWER_ON_MAC } from '@spark-outpost/contracts';
import { STEP_UP_LINE, type CardPlace } from './use-card-place.ts';

export function AnswerOnMac({ reason }: { reason: string }) {
  return (
    <p className="appr-reason appr-on-mac">
      <b>{ANSWER_ON_MAC}</b> {reason}
    </p>
  );
}

export function StepUpLine({ place }: { place: CardPlace }) {
  if (!place.stepUp) return null;
  return <p className="appr-sub">{STEP_UP_LINE}</p>;
}

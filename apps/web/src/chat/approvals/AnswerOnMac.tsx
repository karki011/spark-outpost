import { STEP_UP_LINE, type CardPlace } from './use-card-place.ts';
import { hostWords } from '../../desktop/host-words.ts';

export function AnswerOnMac({ reason }: { reason: string }) {
  return (
    <p className="appr-reason appr-on-mac">
      <b>Answer on your {hostWords().computer}.</b> {reason}
    </p>
  );
}

export function StepUpLine({ place }: { place: CardPlace }) {
  if (!place.stepUp) return null;
  return <p className="appr-sub">{STEP_UP_LINE}</p>;
}

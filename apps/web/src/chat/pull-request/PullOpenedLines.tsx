import type { PrWatch, UpdateProfileRequest } from '@spark-outpost/contracts';
import { PHONE_SWITCH_OFF, useRemoteClient } from '../../phone/use-remote-client.ts';
import { useProfileSetting } from '../../settings/use-profile-setting.ts';
import { XIcon } from '../../ui/icons.tsx';
import { usePaneId } from '../split/chat-pane.ts';
import { OFFER_LINE, offerKey, offerNote, offersFollowUp, ticketLines } from './post-open-model.ts';
import type { FollowUpMode } from './watch-indicator-model.ts';

const turnOn = (): UpdateProfileRequest => ({ prFollowUp: true, prFollowUpAsk: false });

interface FollowUpOfferProps {
  watch: PrWatch;
  mode: FollowUpMode;
  onDismiss: () => void;
}

function FollowUpOffer({ watch, mode, onDismiss }: FollowUpOfferProps) {
  const setting = useProfileSetting(false, turnOn);
  const allowed = useRemoteClient().allows('settings');
  const noteId = usePaneId(`pr-offer-note-${watch.id}`);
  return (
    <div className="ai-note pr-offer" role="group" aria-label={`${OFFER_LINE} #${watch.number}`}>
      <span className="pr-offer-text">{OFFER_LINE}</span>
      <button
        type="button"
        className="pr-offer-on"
        disabled={!allowed || setting.value}
        aria-describedby={noteId}
        onClick={() => setting.set(true)}
      >
        Turn on
      </button>
      <button
        type="button"
        className="pr-offer-x"
        aria-label={`Dismiss the follow-up offer for #${watch.number}`}
        onClick={onDismiss}
      >
        <XIcon />
      </button>
      <span id={noteId} className="pr-offer-note">
        {allowed ? offerNote(mode) : PHONE_SWITCH_OFF}
      </span>
      {setting.error && (
        <span className="pr-offer-error" role="alert">
          {setting.error}
        </span>
      )}
    </div>
  );
}

interface PostOpenLinesProps {
  watch: PrWatch;
  mode: FollowUpMode;
  dismissed: ReadonlySet<string>;
  onDismiss: (key: string) => void;
}

export function PostOpenLines({ watch, mode, dismissed, onDismiss }: PostOpenLinesProps) {
  const offered = offersFollowUp(watch, mode) && !dismissed.has(offerKey(watch));
  return (
    <>
      {ticketLines(watch).map((line) => (
        <p key={line} className="ai-note pr-ticket-line" role="status">
          {line}
        </p>
      ))}
      {offered && (
        <FollowUpOffer watch={watch} mode={mode} onDismiss={() => onDismiss(offerKey(watch))} />
      )}
    </>
  );
}

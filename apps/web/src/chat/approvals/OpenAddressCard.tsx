import { useId, type KeyboardEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  holdsToConfirm,
  OPEN_ADDRESS_OPTION,
  type Approval,
  type ApprovalDecidedValue,
} from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { HoldToConfirm } from '../../ui/HoldToConfirm.tsx';
import { Keys } from '../../ui/Keys.tsx';
import { Breakout } from '../breakout/Breakout.tsx';
import { cardTitle } from './approval-title.ts';
import { ApprovalTitle } from './ApprovalTitle.tsx';
import { askerName } from './ask-reason.ts';
import { cardKeyAction, keyTarget } from './card-keys.ts';
import { ObservedNote } from './ObservedNote.tsx';
import {
  ADDRESS_NOTE,
  ADDRESS_ON_THE_MAC,
  addressByline,
  addressParts,
  openInBrowser,
} from './open-address.ts';
import { Button } from '../../ui/Button.tsx';

interface OpenAddressCardProps {
  approval: Approval;
  agent: string;
  onDecided: (decided: ApprovalDecidedValue) => void;
}

export function OpenAddressCard({ approval, agent, onDecided }: OpenAddressCardProps) {
  const address = approval.payload.openAddress!;
  const headingId = useId();
  const { remote } = useRemoteClient();
  const decide = useMutation({
    mutationFn: (optionId: string) =>
      approvalsApi.decide(approval.id, {
        optionId,
        scope: 'once',
        payloadHash: approval.payloadHash,
      }),
    onSuccess: onDecided,
  });
  const held = holdsToConfirm(approval.payload);
  const busy = decide.isPending;
  const parts = addressParts(address.url, address.host);
  const open = () => {
    if (busy) return;
    openInBrowser(address.url);
    decide.mutate(OPEN_ADDRESS_OPTION.open);
  };
  const dont = () => {
    if (!busy) decide.mutate(OPEN_ADDRESS_OPTION.dont);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (remote) return;
    const action = cardKeyAction({
      key: event.key,
      modifier: event.metaKey || event.ctrlKey || event.altKey,
      shift: event.shiftKey,
      composing: event.nativeEvent.isComposing,
      handled: event.defaultPrevented,
      target: keyTarget(event.target, event.currentTarget),
      holds: held,
    });
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === 'allow') open();
    else dont();
  };

  return (
    <Breakout>
      <div
        className="appr"
        role="group"
        aria-labelledby={headingId}
        id={approvalAnchor(approval.id)}
        onKeyDown={onKeyDown}
      >
        <ApprovalTitle
          approval={approval}
          title={cardTitle(approval)}
          headingId={headingId}
          meta={null}
        />
        <p className="appr-sub">
          {addressByline(askerName(approval, agent), approval.payload.secretSend)}
        </p>
        <p className="appr-address">
          <code aria-label={`Address on ${address.host}: ${address.url}`}>
            {parts.before}
            <b>{parts.host}</b>
            {parts.after}
          </code>
        </p>
        {address.message && (
          <p>
            It says, as untrusted text: <span className="appr-agent-says">{address.message}</span>
          </p>
        )}
        <p>{ADDRESS_NOTE}</p>
        <ObservedNote observed={approval.payload.observed} sendsTo={approval.payload.sendsTo} />
        {remote ? (
          <p className="appr-reason">{ADDRESS_ON_THE_MAC}</p>
        ) : (
          <>
            {held && (
              <HoldToConfirm
                label="Hold to open"
                hint="Press and hold for 1.5 seconds, with the mouse or Space."
                holdingHint="Keep holding. Let go now to cancel."
                releasedHint="Released early. Nothing was opened."
                disabled={busy}
                onConfirm={open}
              />
            )}
            <div className="appr-acts">
              {!held && (
                <Button tone="soft" small aria-keyshortcuts="Enter" disabled={busy} onClick={open}>
                  Open
                  <Keys keys={['⏎']} className="key-hint" />
                </Button>
              )}
              <button
                type="button"
                className="btn line sm deny"
                aria-keyshortcuts="Escape"
                disabled={busy}
                onClick={dont}
              >
                Don’t
                <Keys keys={['Esc']} className="key-hint" />
              </button>
            </div>
          </>
        )}
        {decide.isError && (
          <p className="appr-err" role="alert">
            {decide.error.message}
          </p>
        )}
      </div>
    </Breakout>
  );
}

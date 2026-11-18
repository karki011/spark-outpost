import './crew-review.css';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  sparkActionQuestion,
  type Approval,
  type ApprovalDecidedValue,
} from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { Button } from '../../ui/Button.tsx';
import { WarnIcon, XIcon } from '../../ui/icons.tsx';
import { isAllow } from './approval-outcome.ts';
import { AnswerOnMac, StepUpLine } from './AnswerOnMac.tsx';
import { useCardPlace } from './use-card-place.ts';
import {
  crewReviewName,
  crewReviewSummary,
  endCrewReview,
  useCrewReviewRequest,
  type CrewReviewAction,
} from './crew-review.ts';
import { SparkActionCard } from './SparkActionCard.tsx';

interface CrewReviewCardProps {
  approval: Approval;
  agent: string;
  onDecided: (decided: ApprovalDecidedValue) => void;
}

interface ReviewDialogProps extends CrewReviewCardProps {
  name: string;
  onClose: () => void;
}

function ReviewDialog({ approval, agent, name, onDecided, onClose }: ReviewDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  return (
    <dialog
      ref={dialog}
      className="crw-modal"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <header className="crw-modal-head">
        <h2 id={titleId}>{name}</h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close details"
          title="Close details"
          onClick={close}
        >
          <XIcon />
        </button>
      </header>
      <div className="crw-modal-body">
        <SparkActionCard
          approval={approval}
          agent={agent}
          anchored={false}
          onDecided={(decided) => {
            close();
            onDecided(decided);
          }}
        />
      </div>
    </dialog>
  );
}

function useCrewDecide(approval: Approval, onDecided: (decided: ApprovalDecidedValue) => void) {
  const place = useCardPlace(approval);
  const decide = useMutation({
    mutationFn: async (optionId: string) => {
      await place.confirm();
      return approvalsApi.decide(approval.id, {
        optionId,
        scope: 'once',
        payloadHash: approval.payloadHash,
      });
    },
    onSuccess: onDecided,
  });
  return { place, decide };
}

export function CrewReviewCard({ approval, agent, onDecided }: CrewReviewCardProps) {
  const action = approval.payload.sparkAction as CrewReviewAction;
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  useCrewReviewRequest(approval.id, show);
  const { place, decide } = useCrewDecide(approval, onDecided);
  const name = crewReviewName(action);
  const allow = approval.options.find(isAllow);
  const deny = approval.options.find((option) => !isAllow(option));
  const observed = approval.payload.observed ?? [];
  return (
    <div
      className="appr sac crw-ready"
      role="group"
      aria-labelledby={headingId}
      id={approvalAnchor(approval.id)}
    >
      <span className="ic" aria-hidden="true">
        <i className="appr-dia" />
      </span>
      <span id={headingId} className="crw-ready-what">
        <b>{sparkActionQuestion(action)}</b>
        <small>{crewReviewSummary(action)}</small>
        {observed.length > 0 && (
          <small className="crw-observed">
            <span className="ic" aria-hidden="true">
              <WarnIcon />
            </span>
            <span>This turn read {observed.join(', ')}.</span>
          </small>
        )}
        <StepUpLine place={place} />
        {place.onMac && <AnswerOnMac reason={place.onMac} />}
        {decide.isError && (
          <span className="appr-err" role="alert">
            {decide.error.message}
          </span>
        )}
      </span>
      <span className="crw-acts">
        <Button tone="ghost" small aria-label={`Details for ${name}`} onClick={show}>
          Details
        </Button>
        {!place.onMac && deny && (
          <Button
            tone="ghost"
            small
            className="deny"
            disabled={decide.isPending}
            onClick={() => decide.mutate(deny.optionId)}
          >
            {deny.name}
          </Button>
        )}
        {!place.onMac && allow && (
          <Button
            tone="soft"
            small
            disabled={decide.isPending}
            onClick={() => decide.mutate(allow.optionId)}
          >
            {allow.name}
          </Button>
        )}
      </span>
      {open && (
        <ReviewDialog
          approval={approval}
          agent={agent}
          name={name}
          onDecided={onDecided}
          onClose={() => {
            endCrewReview(approval.id);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

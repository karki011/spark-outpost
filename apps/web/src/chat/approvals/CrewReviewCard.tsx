import './crew-review.css';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Approval, ApprovalDecidedValue } from '@spark-outpost/contracts';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { XIcon } from '../../ui/icons.tsx';
import {
  crewReviewKind,
  crewReviewName,
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
        <h2 id={titleId}>Review {name}</h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close review"
          title="Close review"
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

export function CrewReviewCard({ approval, agent, onDecided }: CrewReviewCardProps) {
  const action = approval.payload.sparkAction as CrewReviewAction;
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  useCrewReviewRequest(approval.id, show);
  const name = crewReviewName(action);
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
        <b>{name} is ready for review</b>
        <small>
          {crewReviewKind(action)} · {agent} asks Spark to do this for you. Nothing changes until
          you answer.
        </small>
      </span>
      <button type="button" className="btn primary sm" aria-label={`Review ${name}`} onClick={show}>
        Review
      </button>
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

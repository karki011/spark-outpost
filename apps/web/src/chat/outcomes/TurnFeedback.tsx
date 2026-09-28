import './turn-feedback.css';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  FEEDBACK_COMMENT_MAX_LENGTH,
  FEEDBACK_REASON_LABELS,
  feedbackReasonSchema,
  type FeedbackRating,
  type FeedbackReason,
  type SaveFeedbackRequest,
  type TurnOutcome,
} from '@spark-outpost/contracts';
import { outcomeKeys, outcomesApi } from '../../api/outcomes.ts';
import { CheckIcon, ThumbDownIcon, ThumbUpIcon } from '../../ui/icons.tsx';
import { useReducedMotion } from '../../ui/motion.ts';
import { easeOut } from '../../ui/transitions.tsx';
import type { FeedbackVariant } from './feedback-host.ts';

const OUTCOME_STALE_MS = 30_000;
const NOTE_REVEAL_S = 0.18;

const noteMotion = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
} as const;

interface Draft {
  rating: FeedbackRating | null;
  reasons: FeedbackReason[];
  comment: string;
}

function draftOf(outcome: TurnOutcome, variant: FeedbackVariant): Draft {
  const saved = outcome.feedback;
  return {
    rating: saved?.rating ?? (variant === 'reverted' ? 'down' : null),
    reasons: saved?.reasons ?? [],
    comment: saved?.comment ?? '',
  };
}

function Thumb({
  rating,
  pressed,
  busy,
  onChoose,
}: {
  rating: FeedbackRating;
  pressed: boolean;
  busy: boolean;
  onChoose(rating: FeedbackRating): void;
}) {
  return (
    <button
      type="button"
      className="icon-btn fb-thumb"
      aria-label={rating === 'up' ? 'Good result' : 'Bad result'}
      aria-pressed={pressed}
      disabled={busy}
      onClick={() => onChoose(rating)}
    >
      {rating === 'up' ? <ThumbUpIcon /> : <ThumbDownIcon />}
    </button>
  );
}

function FeedbackRow({
  outcome,
  variant,
  quiet,
}: {
  outcome: TurnOutcome;
  variant: FeedbackVariant;
  quiet: boolean;
}) {
  const queryClient = useQueryClient();
  const labelId = useId();
  const commentId = useId();
  const firstRef = useRef<HTMLDivElement>(null);
  const reverted = variant === 'reverted';
  const [draft, setDraft] = useState<Draft>(() => draftOf(outcome, variant));
  const [commenting, setCommenting] = useState(reverted || Boolean(outcome.feedback?.comment));
  const refocusThumb = useRef(false);
  const reducedMotion = useReducedMotion();
  const mutation = useMutation({
    mutationFn: (feedback: SaveFeedbackRequest) =>
      outcomesApi.saveFeedback(outcome.runId, feedback),
    onSuccess: (response) => queryClient.setQueryData(outcomeKeys.run(outcome.runId), response),
  });

  useEffect(() => {
    if (commenting || !refocusThumb.current) return;
    refocusThumb.current = false;
    const row = firstRef.current;
    const target =
      row?.querySelector<HTMLButtonElement>('.fb-thumb[aria-pressed="true"]') ??
      row?.querySelector<HTMLButtonElement>('.fb-thumb, .fb-link');
    target?.focus();
  }, [commenting]);

  const cancelComment = () => {
    setDraft({ ...draft, comment: outcome.feedback?.comment ?? '' });
    refocusThumb.current = true;
    setCommenting(false);
  };
  const onNoteKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cancelComment();
  };

  const save = (next: Draft) => {
    setDraft(next);
    if (!next.rating) return;
    mutation.mutate({
      rating: next.rating,
      reasons: next.rating === 'down' ? next.reasons : [],
      comment: next.comment,
    });
  };
  const toggleReason = (reason: FeedbackReason) => {
    const reasons = draft.reasons.includes(reason)
      ? draft.reasons.filter((known) => known !== reason)
      : [...draft.reasons, reason];
    save({ ...draft, rating: 'down', reasons });
  };

  return (
    <div
      className={quiet && !draft.rating ? 'fb quiet' : 'fb'}
      role="group"
      aria-labelledby={labelId}
      ref={firstRef}
    >
      <div className="fb-line">
        <span id={labelId} className={quiet ? 'sr-only' : 'fb-q'}>
          {reverted ? 'What went wrong?' : 'How did it go?'}
        </span>
        {!reverted && (
          <>
            <Thumb
              rating="up"
              pressed={draft.rating === 'up'}
              busy={mutation.isPending}
              onChoose={(rating) => save({ ...draft, rating })}
            />
            <Thumb
              rating="down"
              pressed={draft.rating === 'down'}
              busy={mutation.isPending}
              onChoose={(rating) => save({ ...draft, rating })}
            />
          </>
        )}
        {draft.rating && !commenting && (
          <button type="button" className="fb-link" onClick={() => setCommenting(true)}>
            Add a comment
          </button>
        )}
        <span className="fb-status" role="status">
          {mutation.isSuccess ? 'Saved' : ''}
        </span>
      </div>
      {draft.rating === 'down' && (
        <div className="fb-chips" role="group" aria-label="Reasons">
          {feedbackReasonSchema.options.map((reason) => (
            <button
              key={reason}
              type="button"
              className="fb-chip"
              aria-pressed={draft.reasons.includes(reason)}
              disabled={mutation.isPending}
              onClick={() => toggleReason(reason)}
            >
              {draft.reasons.includes(reason) && <CheckIcon className="fb-tick" />}
              {FEEDBACK_REASON_LABELS[reason]}
            </button>
          ))}
        </div>
      )}
      <AnimatePresence initial={false}>
        {commenting && (
          <motion.div
            key="note"
            className="fb-note-reveal"
            {...noteMotion}
            transition={{ duration: reducedMotion ? 0 : NOTE_REVEAL_S, ease: easeOut }}
          >
            <form
              className="fb-note"
              onSubmit={(event) => {
                event.preventDefault();
                save({ ...draft, rating: draft.rating ?? 'down' });
              }}
            >
              <label htmlFor={commentId} className="sr-only">
                Comment (optional)
              </label>
              <textarea
                id={commentId}
                className="inp"
                rows={2}
                maxLength={FEEDBACK_COMMENT_MAX_LENGTH}
                placeholder="Comment (optional). Stays on this computer."
                value={draft.comment}
                onChange={(event) => setDraft({ ...draft, comment: event.target.value })}
                onKeyDown={onNoteKeyDown}
              />
              <button type="button" className="btn ghost sm" onClick={cancelComment}>
                Cancel
              </button>
              <button type="submit" className="btn line sm" disabled={mutation.isPending}>
                Save
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
      {mutation.isError && (
        <p className="appr-err" role="alert">
          {mutation.error.message}
        </p>
      )}
    </div>
  );
}

export function TurnFeedback({ runId, variant }: { runId: string; variant: FeedbackVariant }) {
  const query = useQuery({
    queryKey: outcomeKeys.run(runId),
    queryFn: () => outcomesApi.get(runId),
    staleTime: OUTCOME_STALE_MS,
  });
  const outcome = query.data?.outcome ?? null;
  if (!outcome) return null;
  const nudged = outcome.prompt !== null || outcome.feedback !== null;
  return <FeedbackRow outcome={outcome} variant={variant} quiet={!nudged} />;
}

import '../approvals/approval-card.css';
import './checkpoint-card.css';
import { use, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CHECKPOINT_OPTION,
  crewTitle,
  type ApprovalDecidedValue,
  type CheckpointPayload,
} from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { queryKeys } from '../../api/client.ts';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { CheckIcon, XIcon } from '../../ui/icons.tsx';
import { mergeDecision } from '../approvals/approval-events.ts';
import { CrewHint } from '../crew/CrewHint.tsx';
import { FollowContext } from '../follow-requests.ts';
import { checkpointSummary } from '../status/pending-summary.ts';
import { Pending } from '../status/Pending.tsx';
import { Action, CheckpointNotes, NoteForm, type Decide } from './card-parts.tsx';
import { AskedList, ClarifyBody } from './ClarifyBody.tsx';
import {
  asksQuestions,
  checkpointQuestion,
  checkpointResult,
  checkpointTitle,
  offers,
  optionName,
  escalateLabel,
  retryLine,
  saidNote,
  type CheckpointApproval,
} from './checkpoint-model.ts';
import { useAutoContinue } from './use-auto-continue.ts';

function PlanBody({ approval, decide }: { approval: CheckpointApproval; decide: Decide }) {
  const [revising, setRevising] = useState(false);
  if (revising) {
    return (
      <NoteForm
        label={
          approval.payload.checkpoint.kind === 'pieces'
            ? 'What should change in the split?'
            : 'What should change in the plan?'
        }
        initial=""
        submit="Revise the plan"
        busy={decide.busy}
        onSubmit={(note) => decide(CHECKPOINT_OPTION.editPlan, note)}
        onCancel={() => setRevising(false)}
      />
    );
  }
  return (
    <div className="appr-acts">
      <Action id={CHECKPOINT_OPTION.approvePlan} approval={approval} decide={decide} kind="primary">
        Approve plan
      </Action>
      <Action id={CHECKPOINT_OPTION.makeChange} approval={approval} decide={decide} kind="primary">
        {optionName(approval, CHECKPOINT_OPTION.makeChange)}
      </Action>
      <Action id={CHECKPOINT_OPTION.buildInOrder} approval={approval} decide={decide}>
        {optionName(approval, CHECKPOINT_OPTION.buildInOrder)}
      </Action>
      {offers(approval, CHECKPOINT_OPTION.editPlan) && (
        <button
          type="button"
          className="btn line sm"
          onClick={() => {
            decide.hold();
            setRevising(true);
          }}
        >
          {optionName(approval, CHECKPOINT_OPTION.editPlan)}
        </button>
      )}
      <Action id={CHECKPOINT_OPTION.stop} approval={approval} decide={decide} kind="stop">
        Stop
      </Action>
    </div>
  );
}

function PendingBody({ approval, decide }: { approval: CheckpointApproval; decide: Decide }) {
  const checkpoint = approval.payload.checkpoint;
  switch (checkpoint.kind) {
    case 'clarify':
      return <ClarifyBody approval={approval} decide={decide} />;
    case 'plan':
    case 'pieces':
      return <PlanBody approval={approval} decide={decide} />;
    case 'retry':
      return (
        <div className="appr-acts">
          <Action id={CHECKPOINT_OPTION.retry} approval={approval} decide={decide} kind="primary">
            Retry
          </Action>
          <Action id={CHECKPOINT_OPTION.stopReport} approval={approval} decide={decide} kind="stop">
            Stop and report
          </Action>
        </div>
      );
    case 'stuck':
      return (
        <div className="appr-acts">
          <Action
            id={CHECKPOINT_OPTION.continueStuck}
            approval={approval}
            decide={decide}
            kind="primary"
          >
            Continue
          </Action>
          <Action id={CHECKPOINT_OPTION.stopReport} approval={approval} decide={decide} kind="stop">
            Stop and report
          </Action>
        </div>
      );
    case 'verify':
      return (
        <div className="appr-acts">
          <Action
            id={CHECKPOINT_OPTION.finishUnverified}
            approval={approval}
            decide={decide}
            kind="primary"
          >
            Finish as it is
          </Action>
          <Action id={CHECKPOINT_OPTION.retry} approval={approval} decide={decide}>
            {escalateLabel(checkpoint)}
          </Action>
          <Action id={CHECKPOINT_OPTION.stop} approval={approval} decide={decide} kind="stop">
            Stop
          </Action>
        </div>
      );
    case 'ownership':
      return (
        <div className="appr-acts">
          <Action
            id={CHECKPOINT_OPTION.keepInPiece}
            approval={approval}
            decide={decide}
            kind="primary"
          >
            {checkpoint.agent ? `Keep it in ${checkpoint.agent}’s piece` : 'Keep it in the piece'}
          </Action>
          <Action id={CHECKPOINT_OPTION.stop} approval={approval} decide={decide} kind="stop">
            Stop
          </Action>
        </div>
      );
    case 'pr_split':
    case 'compact':
      return (
        <div className="appr-acts">
          {approval.options.map((option, index) => (
            <Action
              key={option.optionId}
              id={option.optionId}
              approval={approval}
              decide={decide}
              kind={index === 0 ? 'primary' : 'line'}
            >
              {option.name}
            </Action>
          ))}
        </div>
      );
    case 'accept':
    case 'merge_conflict':
    case 'budget':
      return null;
  }
}

function CheckpointHeading({ payload, title }: { payload: CheckpointPayload; title: string }) {
  if (!payload.agent) return <b>{title}</b>;
  const who = crewTitle(payload.agent);
  return (
    <CrewHint label={asksQuestions(payload) ? `Asked by ${who}` : who}>
      <b>{title}</b>
    </CrewHint>
  );
}

function lead(approval: CheckpointApproval): string | null {
  const checkpoint = approval.payload.checkpoint;
  if (checkpoint.kind === 'retry') return retryLine(checkpoint);
  return null;
}

export function CheckpointCard({ approval: incoming }: { approval: CheckpointApproval }) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const [local, setLocal] = useState<ApprovalDecidedValue | null>(null);
  const approval = local ? (mergeDecision([incoming], local)[0] as CheckpointApproval) : incoming;
  const mutation = useMutation({
    mutationFn: ({ optionId, note }: { optionId: string; note?: string }) =>
      approvalsApi.decide(approval.id, {
        optionId,
        scope: 'once',
        payloadHash: approval.payloadHash,
        ...(note ? { note } : {}),
      }),
    onSuccess: (decided) => {
      setLocal(decided);
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
    },
  });
  const { countdown, hold } = useAutoContinue(approval);
  const followRequests = use(FollowContext);
  const decide: Decide = Object.assign(
    (optionId: string, note?: string) => {
      followRequests?.request();
      mutation.mutate(note === undefined ? { optionId } : { optionId, note });
    },
    { busy: mutation.isPending, countdown, hold },
  );
  const checkpoint = approval.payload.checkpoint;
  const pending = approval.status === 'pending';
  const subtitle = lead(approval);
  const stopped =
    approval.decisionOptionId === CHECKPOINT_OPTION.stop || approval.status !== 'allowed';

  const title = checkpointTitle(checkpoint);
  const questions = asksQuestions(checkpoint);
  const said = saidNote(approval);

  return (
    <Pending
      id={approval.id}
      order={approval.createdAt}
      summary={checkpointSummary(checkpoint, title)}
      pending={pending}
    >
      <div
        className={pending ? `appr ck ${checkpoint.kind}` : `appr ck ${checkpoint.kind} decided`}
        role="group"
        aria-labelledby={headingId}
        id={approvalAnchor(approval.id)}
      >
        <div className="appr-h">
          <span className="ic" aria-hidden="true">
            <i className={pending ? 'appr-dia' : 'appr-dia still'} />
          </span>
          <span id={headingId}>
            <CheckpointHeading payload={checkpoint} title={title} />{' '}
            {checkpointQuestion(checkpoint)}
          </span>
        </div>
        {subtitle && <p className="ck-lead">{subtitle}</p>}
        {pending && checkpoint.waitsFor && (
          <p className="ck-wait" role="status">
            {checkpoint.waitsFor}
          </p>
        )}
        {checkpoint.reason && !questions && <p>{checkpoint.reason}</p>}
        <CheckpointNotes payload={checkpoint} />
        {questions && !pending && <AskedList approval={approval} />}
        {pending ? (
          <PendingBody approval={approval} decide={decide} />
        ) : (
          <div className="appr-res" role="status">
            {stopped ? <XIcon /> : <CheckIcon />}
            <b>{checkpointResult(approval)}</b>
            {said && <span className="ck-said">“{said}”</span>}
          </div>
        )}
        {mutation.isError && (
          <p className="appr-err" role="alert">
            {mutation.error.message}
          </p>
        )}
      </div>
    </Pending>
  );
}

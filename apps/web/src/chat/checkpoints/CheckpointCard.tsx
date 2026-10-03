import '../approvals/approval-card.css';
import './checkpoint-card.css';
import { useId, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CHECKPOINT_OPTION,
  crewTitle,
  type ApprovalDecidedValue,
  type CheckpointPayload,
  type ConflictSide,
  type MergeConflict,
} from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { queryKeys } from '../../api/client.ts';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { useViewChanges } from '../../tasks/view-changes.ts';
import { CheckIcon, XIcon } from '../../ui/icons.tsx';
import { DiffView } from '../approvals/DiffView.tsx';
import { mergeDecision } from '../approvals/approval-events.ts';
import { CrewHint } from '../crew/CrewHint.tsx';
import { Docked } from '../dock/Docked.tsx';
import { Action, CheckpointNotes, NoteForm, type Decide } from './card-parts.tsx';
import { ClarifyBody } from './ClarifyBody.tsx';
import {
  asksQuestions,
  budgetLine,
  checkpointQuestion,
  changesSummary,
  checkpointResult,
  checkpointTitle,
  offers,
  optionName,
  escalateLabel,
  retryLine,
  type CheckpointApproval,
} from './checkpoint-model.ts';
import { useAutoContinue } from './use-auto-continue.ts';

function FileList({ files }: { files: CheckpointPayload['files'] }) {
  return (
    <ul className="ck-files" aria-label="Changed files">
      {files.map((file) => (
        <li key={file.path}>
          <code>{file.path}</code>
          <span className={`ck-change ${file.change}`}>{file.change}</span>
        </li>
      ))}
    </ul>
  );
}

function ChangesSummary({ payload }: { payload: CheckpointPayload }) {
  const viewChanges = useViewChanges();
  if (payload.files.length === 0) return null;
  return (
    <div className="ck-changes">
      <p className="ck-sum">
        <span>{changesSummary(payload)}</span>
        {viewChanges && (
          <button type="button" className="ck-view" onClick={() => viewChanges()}>
            View changes
          </button>
        )}
      </p>
      <details className="ck-more">
        <summary>Show files</summary>
        <FileList files={payload.files} />
      </details>
    </div>
  );
}

function AcceptActions({ approval, decide }: { approval: CheckpointApproval; decide: Decide }) {
  const [fixing, setFixing] = useState(false);
  if (fixing) {
    return (
      <NoteForm
        label="What should be fixed?"
        initial=""
        submit="Ask for a fix"
        busy={decide.busy}
        onSubmit={(note) => decide(CHECKPOINT_OPTION.fix, note)}
        onCancel={() => setFixing(false)}
      />
    );
  }
  return (
    <div className="appr-acts">
      <Action id={CHECKPOINT_OPTION.keep} approval={approval} decide={decide} kind="primary">
        Keep
      </Action>
      <Action id={CHECKPOINT_OPTION.fixFindings} approval={approval} decide={decide}>
        {optionName(approval, CHECKPOINT_OPTION.fixFindings)}
      </Action>
      {offers(approval, CHECKPOINT_OPTION.fix) && (
        <button type="button" className="btn line sm" onClick={() => setFixing(true)}>
          Fix
        </button>
      )}
      <Action id={CHECKPOINT_OPTION.revert} approval={approval} decide={decide} kind="stop">
        Revert
      </Action>
    </div>
  );
}

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

function ConflictSideView({
  path,
  base,
  side,
}: {
  path: string;
  base: string | null;
  side: ConflictSide;
}) {
  return (
    <div className="ck-side">
      <p className="ck-side-h">{side.name}’s change</p>
      {side.text !== null ? (
        <DiffView diff={{ path, oldText: base, newText: side.text }} />
      ) : (
        <pre className="ck-diff">{side.diff}</pre>
      )}
    </div>
  );
}

function ConflictFiles({ conflict }: { conflict: MergeConflict }) {
  return (
    <ul className="ck-conflicts" aria-label="Conflicting changes">
      {conflict.files.map((file) => (
        <li key={file.path}>
          <code>{file.path}</code>
          <div className="ck-sides">
            <ConflictSideView path={file.path} base={file.base} side={file.first} />
            <ConflictSideView path={file.path} base={file.base} side={file.second} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function MergeConflictBody({ approval, decide }: { approval: CheckpointApproval; decide: Decide }) {
  const conflict = approval.payload.checkpoint.conflict;
  if (!conflict) return null;
  return (
    <>
      <ConflictFiles conflict={conflict} />
      <div className="appr-acts">
        <Action id={CHECKPOINT_OPTION.keepFirst} approval={approval} decide={decide} kind="primary">
          Keep {conflict.first}
        </Action>
        <Action id={CHECKPOINT_OPTION.keepSecond} approval={approval} decide={decide}>
          Keep {conflict.second}’s
        </Action>
        <Action id={CHECKPOINT_OPTION.stop} approval={approval} decide={decide} kind="stop">
          Stop
        </Action>
      </div>
    </>
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
    case 'accept':
      return <ChangesSummary payload={checkpoint} />;
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
    case 'merge_conflict':
      return <MergeConflictBody approval={approval} decide={decide} />;
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
          <Action id={CHECKPOINT_OPTION.revertFile} approval={approval} decide={decide}>
            Revert that file
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
    case 'budget':
      return (
        <div className="appr-acts">
          <Action
            id={CHECKPOINT_OPTION.continueBudget}
            approval={approval}
            decide={decide}
            kind="primary"
          >
            Continue
          </Action>
          <Action id={CHECKPOINT_OPTION.stop} approval={approval} decide={decide} kind="stop">
            Stop
          </Action>
        </div>
      );
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

function AskedList({ payload }: { payload: CheckpointPayload }) {
  return (
    <ol className="ck-asked">
      {payload.questions.map((question) => (
        <li key={question.question}>
          {question.question} <span>Best guess: {question.default}</span>
        </li>
      ))}
    </ol>
  );
}

function lead(approval: CheckpointApproval): string | null {
  const checkpoint = approval.payload.checkpoint;
  if (checkpoint.kind === 'retry') return retryLine(checkpoint);
  if (checkpoint.kind === 'budget') return budgetLine(checkpoint);
  return null;
}

export function CheckpointCard({
  approval: incoming,
  footer,
}: {
  approval: CheckpointApproval;
  footer?: ReactNode;
}) {
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
  const decide: Decide = Object.assign(
    (optionId: string, note?: string) =>
      mutation.mutate(note === undefined ? { optionId } : { optionId, note }),
    { busy: mutation.isPending, countdown, hold },
  );
  const checkpoint = approval.payload.checkpoint;
  const pending = approval.status === 'pending';
  const subtitle = lead(approval);
  const stopped =
    approval.decisionOptionId === CHECKPOINT_OPTION.stop || approval.status !== 'allowed';

  const actionsFirst = pending && checkpoint.kind === 'accept';
  const title = checkpointTitle(checkpoint);
  const questions = asksQuestions(checkpoint);

  return (
    <Docked id={approval.id} order={approval.createdAt} label={title} pending={pending}>
      <div
        className={pending ? `appr ck ${checkpoint.kind}` : `appr ck ${checkpoint.kind} decided`}
        role="group"
        aria-labelledby={headingId}
        id={approvalAnchor(approval.id)}
      >
        <div className={actionsFirst ? 'ck-top' : undefined}>
          <div className="appr-h">
            <span className="ic" aria-hidden="true">
              <i className={pending ? 'appr-dia' : 'appr-dia still'} />
            </span>
            <span id={headingId}>
              <CheckpointHeading payload={checkpoint} title={title} />{' '}
              {checkpointQuestion(checkpoint)}
            </span>
          </div>
          {actionsFirst && <AcceptActions approval={approval} decide={decide} />}
        </div>
        {subtitle && <p className="ck-lead">{subtitle}</p>}
        {pending && checkpoint.waitsFor && (
          <p className="ck-wait" role="status">
            {checkpoint.waitsFor}
          </p>
        )}
        {checkpoint.reason && !questions && <p>{checkpoint.reason}</p>}
        <CheckpointNotes payload={checkpoint} />
        {questions && !pending && <AskedList payload={checkpoint} />}
        {pending ? (
          <PendingBody approval={approval} decide={decide} />
        ) : (
          <div className="appr-res" role="status">
            {stopped ? <XIcon /> : <CheckIcon />}
            <b>{checkpointResult(approval)}</b>
            {approval.note && <span className="ck-said">“{approval.note}”</span>}
          </div>
        )}
        {!pending && footer}
        {mutation.isError && (
          <p className="appr-err" role="alert">
            {mutation.error.message}
          </p>
        )}
      </div>
    </Docked>
  );
}

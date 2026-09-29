import '../approvals/approval-card.css';
import './checkpoint-card.css';
import { useId, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CHECKPOINT_OPTION,
  clarifyOptionId,
  type ApprovalDecidedValue,
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
import {
  autoLabel,
  budgetLine,
  checkpointQuestion,
  checkpointResult,
  checkpointTitle,
  offers,
  optionName,
  escalateLabel,
  retryLine,
  type CheckpointApproval,
} from './checkpoint-model.ts';
import { useAutoContinue, type Countdown } from './use-auto-continue.ts';

interface Decide {
  (optionId: string, note?: string): void;
  busy: boolean;
  countdown: Countdown | null;
  hold(): void;
}

function NoteForm({
  label,
  initial,
  submit,
  onSubmit,
  onCancel,
  onType,
  busy,
}: {
  label: string;
  initial: string;
  submit: string;
  onSubmit(note: string): void;
  onCancel?: () => void;
  onType?: () => void;
  busy: boolean;
}) {
  const [note, setNote] = useState(initial);
  const id = useId();
  return (
    <form
      className="ck-note"
      onSubmit={(event) => {
        event.preventDefault();
        if (note.trim()) onSubmit(note.trim());
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        className="inp"
        rows={Math.min(8, Math.max(2, initial.split('\n').length + 1))}
        placeholder={label}
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
          onType?.();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="ck-note-acts">
        <button type="submit" className="btn primary sm" disabled={busy || !note.trim()}>
          {submit}
        </button>
        {onCancel && (
          <button type="button" className="btn ghost sm" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Action({
  id,
  approval,
  decide,
  kind = 'line',
  children,
}: {
  id: string;
  approval: CheckpointApproval;
  decide: Decide;
  kind?: 'primary' | 'line' | 'stop';
  children: ReactNode;
}) {
  if (!offers(approval, id)) return null;
  const className = kind === 'stop' ? 'btn ghost sm deny' : `btn ${kind} sm`;
  const counting = decide.countdown?.optionId === id ? decide.countdown : null;
  return (
    <button type="button" className={className} disabled={decide.busy} onClick={() => decide(id)}>
      {counting ? <span className="ck-auto">{autoLabel(id, counting.seconds)}</span> : children}
    </button>
  );
}

function ClarifyBody({ approval, decide }: { approval: CheckpointApproval; decide: Decide }) {
  const choices = approval.payload.checkpoint.choices;
  return (
    <>
      {choices.length > 0 && (
        <div className="appr-acts ck-choices">
          {choices.map((choice, index) => (
            <button
              key={choice}
              type="button"
              className={index === 0 ? 'btn primary sm' : 'btn line sm'}
              disabled={decide.busy}
              onClick={() => decide(clarifyOptionId(index))}
            >
              {choice}
            </button>
          ))}
        </div>
      )}
      {offers(approval, CHECKPOINT_OPTION.answer) && (
        <NoteForm
          label={choices.length > 0 ? 'Or answer in your own words' : 'Answer in your own words'}
          initial=""
          submit="Send"
          busy={decide.busy}
          onType={decide.hold}
          onSubmit={(note) => decide(CHECKPOINT_OPTION.answer, note)}
        />
      )}
      <div className="appr-acts ck-foot">
        <Action id={CHECKPOINT_OPTION.useDefaults} approval={approval} decide={decide}>
          {optionName(approval, CHECKPOINT_OPTION.useDefaults)}
        </Action>
        <Action id={CHECKPOINT_OPTION.clarifyRules} approval={approval} decide={decide}>
          Let the rules decide
        </Action>
        <Action id={CHECKPOINT_OPTION.stop} approval={approval} decide={decide} kind="stop">
          Stop
        </Action>
      </div>
    </>
  );
}

function AcceptBody({ approval, decide }: { approval: CheckpointApproval; decide: Decide }) {
  const [fixing, setFixing] = useState(false);
  const viewChanges = useViewChanges();
  const files = approval.payload.checkpoint.files;
  return (
    <>
      {files.length > 0 && (
        <ul className="ck-files" aria-label="Changed files">
          {files.map((file) => (
            <li key={file.path}>
              <code>{file.path}</code>
              <span className={`ck-change ${file.change}`}>{file.change}</span>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && viewChanges && (
        <button type="button" className="ck-view" onClick={() => viewChanges()}>
          View changes
        </button>
      )}
      {fixing ? (
        <NoteForm
          label="What should be fixed?"
          initial=""
          submit="Ask for a fix"
          busy={decide.busy}
          onSubmit={(note) => decide(CHECKPOINT_OPTION.fix, note)}
          onCancel={() => setFixing(false)}
        />
      ) : (
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
      )}
    </>
  );
}

function PlanBody({ approval, decide }: { approval: CheckpointApproval; decide: Decide }) {
  const [revising, setRevising] = useState(false);
  if (revising) {
    return (
      <NoteForm
        label="What should change in the plan?"
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
      return <PlanBody approval={approval} decide={decide} />;
    case 'accept':
      return <AcceptBody approval={approval} decide={decide} />;
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

  return (
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
          <b>{checkpointTitle(checkpoint)}</b> {checkpointQuestion(checkpoint)}
        </span>
      </div>
      {subtitle && <p className="ck-lead">{subtitle}</p>}
      {checkpoint.reason && <p>{checkpoint.reason}</p>}
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
  );
}

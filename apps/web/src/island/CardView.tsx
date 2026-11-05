import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { type Approval, type ApprovalOption, type ApprovalScope } from '@spark-outpost/contracts';
import { projectAllowOption } from '../chat/approvals/approval-outcome.ts';
import {
  asksQuestions,
  checkpointTitle,
  isCheckpoint,
  type CheckpointApproval,
} from '../chat/checkpoints/checkpoint-model.ts';
import { useAutoContinue } from '../chat/checkpoints/use-auto-continue.ts';
import { attentionLine } from '../conversations/row-state.ts';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { askedPrompt, pickDecision, questionPicks, type QuestionPick } from './asked-question.ts';
import { approvalHunk, baseName } from './island-diff.ts';
import { IslandDiff } from './IslandDiff.tsx';
import type { Card } from './island-model.ts';
import { Kbd, useArmed, Who } from './island-parts.tsx';
import type { ChatAgent } from './use-island-data.ts';
import { findOption, useDecide, type Decided } from './use-decide.ts';

interface CardViewProps {
  card: Card;
  index: number;
  total: number;
  agent: ChatAgent;
  focusSignal: number;
  onDecided: (decided: Decided) => void;
  onOpenChat: (id: string) => void;
  onLater: () => void;
}

const GRACE_SECONDS = 10;

function shortCwd(cwd: string | null): string | null {
  if (!cwd) return null;
  return cwd.replace(/^\/Users\/[^/]+/, '~');
}

export function cardHeading(card: Card, who: string): string {
  const approval = card.approval;
  if (card.kind === 'force') return `${who} wants to force-push`;
  if (!approval) return attentionLine(card.chat.attention);
  if (approval.kind === 'execute') return `${who} wants to run a command`;
  if (approval.kind === 'edit') {
    return approval.payload.paths.length > 1
      ? `${who} wants to change files`
      : `${who} wants to change a file`;
  }
  if (approval.payload.sparkAction) return approval.title;
  const checkpoint = approval.payload.checkpoint;
  if (checkpoint && asksQuestions(checkpoint)) return checkpointTitle(checkpoint);
  return `${who} wants to ${approval.title}`;
}

export function Target({ approval }: { approval: Approval }) {
  const command = approval.payload.command;
  const cwd = shortCwd(approval.payload.cwd);
  if (command) {
    return (
      <div className="isl-code">
        {cwd && <span className="dim">{cwd} $ </span>}
        {command}
      </div>
    );
  }
  if (approval.payload.paths.length > 0) {
    const hunk = approvalHunk(approval);
    return (
      <>
        <div className="isl-code">{approval.payload.paths.slice(0, 4).join('\n')}</div>
        {hunk && (
          <IslandDiff diff={hunk} mode="hunk" label={`First change to ${baseName(hunk.path)}`} />
        )}
      </>
    );
  }
  return <div className="isl-code">{approval.title}</div>;
}

function ForceActions({
  approval,
  armed,
  onAllow,
  onDeny,
  onOpen,
  onLater,
  busy,
}: {
  approval: Approval;
  armed: boolean;
  busy: boolean;
  onAllow: (option: ApprovalOption) => void;
  onDeny: () => void;
  onOpen: () => void;
  onLater: () => void;
}) {
  const [left, setLeft] = useState<number | null>(null);
  const allow = findOption(approval, 'allow_once');
  const handlers = useRef({ onAllow });
  useEffect(() => {
    handlers.current = { onAllow };
  }, [onAllow]);
  useEffect(() => {
    if (left === null || !allow) return;
    if (left <= 0) {
      handlers.current.onAllow(allow);
      return;
    }
    const timer = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, allow]);

  if (left !== null) {
    return (
      <div className="isl-timer" role="status">
        <span>Force-pushing in {left}s</span>
        <div className="isl-bar danger" aria-hidden="true">
          <i style={{ transform: `scaleX(${left / GRACE_SECONDS})` }} />
        </div>
        <button type="button" className="isl-btn" onClick={() => setLeft(null)} autoFocus>
          Undo
        </button>
      </div>
    );
  }
  return (
    <div className="isl-acts">
      <button
        type="button"
        className="isl-btn"
        data-arming={!armed || undefined}
        disabled={!armed || busy}
        onClick={onDeny}
      >
        Deny <Kbd>N</Kbd>
      </button>
      {allow && (
        <span className="isl-hold">
          <HoldToConfirm
            label="Hold to force-push"
            hint="Press and hold for about one second to confirm."
            holdingHint="Keep holding. Let go now to cancel."
            releasedHint="Released early. Nothing was pushed."
            holdMs={1200}
            disabled={!armed || busy}
            onConfirm={() => setLeft(GRACE_SECONDS)}
          />
        </span>
      )}
      <button type="button" className="isl-btn link" onClick={onOpen}>
        Open chat
      </button>
      <button type="button" className="isl-btn link" onClick={onLater}>
        Later
      </button>
    </div>
  );
}

export function QuestionChoices({
  approval,
  armed,
  busy,
  onPick,
}: {
  approval: CheckpointApproval;
  armed: boolean;
  busy: boolean;
  onPick: (pick: QuestionPick) => void;
}) {
  const auto = useAutoContinue(approval);
  const picks = questionPicks(approval);
  const [paused, setPaused] = useState(false);
  const total = approval.autoContinueAt
    ? Math.max(
        1,
        Math.round((Date.parse(approval.autoContinueAt) - Date.parse(approval.createdAt)) / 1000),
      )
    : null;
  return (
    <div
      onPointerEnter={() => {
        if (!auto.countdown) return;
        setPaused(true);
        auto.hold();
      }}
    >
      <div className="isl-opts">
        {picks.map((pick, index) => (
          <button
            key={pick.label}
            type="button"
            className={index === 0 ? 'isl-btn opt def' : 'isl-btn opt'}
            data-arming={!armed || undefined}
            disabled={!armed || busy}
            onClick={() => onPick(pick)}
          >
            {pick.label}
          </button>
        ))}
      </div>
      {approval.status === 'pending' && approval.payload.checkpoint.waitsFor && (
        <div className="isl-timer" role="status">
          <span>{approval.payload.checkpoint.waitsFor}</span>
        </div>
      )}
      {(auto.countdown || paused) && (
        <div className="isl-timer">
          <span>
            {paused
              ? 'Paused while you look'
              : `Skips in ${auto.countdown!.seconds}s and uses the default`}
          </span>
          {auto.countdown && total && (
            <div className="isl-bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${auto.countdown.seconds / total})` }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CardView({
  card,
  index,
  total,
  agent,
  focusSignal,
  onDecided,
  onOpenChat,
  onLater,
}: CardViewProps) {
  const approval = card.approval;
  const armed = useArmed(approval?.id ?? card.chat.id);
  const decide = useDecide(approval, onDecided, agent.name);
  const cardRef = useRef<HTMLDivElement>(null);
  const title = cardHeading(card, agent.name);

  useEffect(() => {
    if (focusSignal > 0) cardRef.current?.focus({ preventScroll: true });
  }, [focusSignal, card.loading]);

  const allow = approval ? findOption(approval, 'allow_once') : undefined;
  const deny = approval
    ? (findOption(approval, 'reject_once') ?? findOption(approval, 'reject_always'))
    : undefined;
  const always =
    card.kind === 'approval' &&
    approval &&
    approval.reason === null &&
    approval.kind === 'execute' &&
    approval.payload.command
      ? projectAllowOption(approval.options)
      : undefined;
  const send = (option: ApprovalOption | undefined, scope: ApprovalScope = 'once') => {
    if (!option || !armed || decide.isPending || card.loading) return;
    decide.mutate({ option, scope });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== cardRef.current || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'y' && card.kind === 'approval') send(allow);
    else if (key === 'n' && (card.kind === 'approval' || card.kind === 'force')) send(deny);
    else return;
    event.preventDefault();
  };

  const keys =
    card.kind === 'force' ? 'N to deny, hold the button to confirm.' : 'Y to allow, N to deny.';
  return (
    <div
      ref={cardRef}
      className="isl-card isl-kcard"
      data-wash={card.kind === 'force' ? 'danger' : card.kind === 'question' ? 'accent' : 'warn'}
      data-keys={
        card.kind === 'force' ? 'N deny' : card.kind === 'approval' ? 'Y allow · N deny' : undefined
      }
      tabIndex={0}
      role="group"
      aria-label={`${title}${approval?.payload.command ? `: ${approval.payload.command}` : ''}. ${card.kind === 'approval' || card.kind === 'force' ? keys : ''}`}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (!(event.target as HTMLElement).closest('button'))
          cardRef.current?.focus({ preventScroll: true });
      }}
    >
      <Who
        name={agent.name}
        role={agent.role}
        provider={agent.provider}
        title={card.chat.title}
        expression="unsure"
      />
      <div className="isl-ttl">{title}</div>
      {card.loading && (
        <div className="isl-skl" aria-hidden="true">
          <i />
          <i style={{ width: '58%' }} />
        </div>
      )}
      {approval && card.kind !== 'question' && card.kind !== 'open' && (
        <Target approval={approval} />
      )}
      {card.kind === 'force' && (
        <p className="isl-dangerline">
          Rewrites history on {approval?.payload.forcePush?.join(', ') ?? 'the remote'}. Anyone who
          pulled will need to reset.
        </p>
      )}
      {approval &&
        (approval.reason ?? approval.payload.asksBecause) &&
        card.kind === 'approval' && (
          <p className="isl-hint">{approval.reason ?? approval.payload.asksBecause}.</p>
        )}
      {card.kind === 'question' && approval && isCheckpoint(approval) && (
        <>
          {askedPrompt(approval) && <p className="isl-hint">{askedPrompt(approval)}</p>}
          <QuestionChoices
            approval={approval}
            armed={armed}
            busy={decide.isPending}
            onPick={(pick) => decide.mutate(pickDecision(pick, agent.name))}
          />
        </>
      )}
      {card.kind === 'approval' && (
        <div className="isl-acts">
          <button
            type="button"
            className="isl-btn"
            data-arming={!armed || undefined}
            disabled={!armed || decide.isPending || !deny}
            onClick={() => send(deny)}
          >
            Deny <Kbd>N</Kbd>
          </button>
          <button
            type="button"
            className="isl-btn primary"
            data-arming={!armed || undefined}
            disabled={!armed || decide.isPending || !allow}
            onClick={() => send(allow)}
          >
            Allow once <Kbd>Y</Kbd>
          </button>
          {always && (
            <button
              type="button"
              className="isl-btn"
              data-arming={!armed || undefined}
              disabled={!armed || decide.isPending}
              onClick={() => send(always, 'project')}
            >
              Always in this project
            </button>
          )}
          <button type="button" className="isl-btn link" onClick={() => onOpenChat(card.chat.id)}>
            {card.chat.sessionType === 'terminal' ? 'Open terminal' : 'Open chat'}
          </button>
          <button type="button" className="isl-btn link" onClick={onLater}>
            Later
          </button>
        </div>
      )}
      {card.kind === 'force' && approval && (
        <ForceActions
          approval={approval}
          armed={armed}
          busy={decide.isPending}
          onAllow={(option) => decide.mutate({ option, scope: 'once' })}
          onDeny={() => send(deny)}
          onOpen={() => onOpenChat(card.chat.id)}
          onLater={onLater}
        />
      )}
      {(card.kind === 'open' || card.kind === 'question') && (
        <div className="isl-acts">
          <button
            type="button"
            className={card.kind === 'open' ? 'isl-btn primary' : 'isl-btn link'}
            onClick={() => onOpenChat(card.chat.id)}
          >
            {card.chat.sessionType === 'terminal' ? 'Open terminal' : 'Open chat'}
          </button>
          <button type="button" className="isl-btn link" onClick={onLater}>
            Later
          </button>
        </div>
      )}
      {total > 1 && (
        <span className="isl-queue">
          {index} of {total}
        </span>
      )}
      {decide.isError && (
        <p className="isl-err" role="alert">
          {decide.error.message}
        </p>
      )}
    </div>
  );
}
